from flask import Flask, request, jsonify, send_file, session
from flask_cors import CORS
from s3_handler import S3Handler
import json
import os
import logging
from datetime import datetime
import uuid
import io

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'dev-secret-key')

# Увеличение лимитов для загрузки больших файлов
app.config['MAX_CONTENT_LENGTH'] = 10 * 1024 * 1024 * 1024  # 10GB
app.config['MAX_FORM_MEMORY_SIZE'] = 1024 * 1024 * 1024  # 1GB для форм

CORS(app, supports_credentials=True)

# Настройка логирования
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('/var/log/nginx/s3_manager.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger('s3_manager')

# Директория для хранения профилей
PROFILES_DIR = '/app/profiles'
os.makedirs(PROFILES_DIR, exist_ok=True)

# Хранилище подключений (в памяти)
connections = {}

@app.errorhandler(413)
def request_entity_too_large(error):
    """Обработка ошибки слишком большого файла"""
    logger.error(f"Файл слишком большой: {error}")
    return jsonify({
        "success": False, 
        "message": "Файл слишком большой. Максимальный размер: 10GB"
    }), 413

@app.errorhandler(500)
def internal_server_error(error):
    """Обработка внутренней ошибки сервера"""
    logger.error(f"Внутренняя ошибка сервера: {error}")
    return jsonify({
        "success": False,
        "message": "Внутренняя ошибка сервера"
    }), 500

@app.route('/api/profiles', methods=['GET'])
def get_profiles():
    """Получение списка профилей"""
    profiles = []
    try:
        for filename in os.listdir(PROFILES_DIR):
            if filename.endswith('.json'):
                with open(os.path.join(PROFILES_DIR, filename), 'r') as f:
                    profile = json.load(f)
                    profiles.append(profile)
    except Exception as e:
        logger.error(f"Ошибка чтения профилей: {str(e)}")
    
    return jsonify(profiles)

@app.route('/api/profiles', methods=['POST'])
def save_profile():
    """Сохранение профиля"""
    try:
        profile = request.json
        profile_id = str(uuid.uuid4())[:8]
        profile['id'] = profile_id
        
        with open(os.path.join(PROFILES_DIR, f"{profile_id}.json"), 'w') as f:
            json.dump(profile, f)
        
        logger.info(f"Профиль сохранен: {profile['name']}")
        return jsonify({"success": True, "profile": profile})
        
    except Exception as e:
        logger.error(f"Ошибка сохранения профиля: {str(e)}")
        return jsonify({"success": False, "message": str(e)}), 500

@app.route('/api/profiles/<profile_id>', methods=['DELETE'])
def delete_profile(profile_id):
    """Удаление профиля"""
    try:
        os.remove(os.path.join(PROFILES_DIR, f"{profile_id}.json"))
        logger.info(f"Профиль удален: {profile_id}")
        return jsonify({"success": True})
    except Exception as e:
        logger.error(f"Ошибка удаления профиля: {str(e)}")
        return jsonify({"success": False, "message": str(e)}), 500

@app.route('/api/connect', methods=['POST'])
def connect():
    """Подключение к S3"""
    try:
        data = request.json
        conn_id = str(uuid.uuid4())
        
        handler = S3Handler()
        result = handler.connect(
            data['endpoint'],
            data['access_key'],
            data['secret_key'],
            data['bucket'],
            data.get('use_ssl', True)
        )
        
        if result['success']:
            connections[conn_id] = handler
            session['conn_id'] = conn_id
            session['current_path'] = ''
            
            logger.info(f"Новое подключение: {data['endpoint']}/{data['bucket']}")
            return jsonify({
                "success": True,
                "conn_id": conn_id,
                "message": result['message']
            })
        else:
            return jsonify(result), 400
            
    except Exception as e:
        logger.error(f"Ошибка подключения: {str(e)}")
        return jsonify({"success": False, "message": str(e)}), 500

@app.route('/api/disconnect', methods=['POST'])
def disconnect():
    """Отключение от S3"""
    conn_id = session.get('conn_id')
    if conn_id and conn_id in connections:
        del connections[conn_id]
        session.clear()
        logger.info("Подключение закрыто")
    return jsonify({"success": True})

@app.route('/api/list', methods=['GET'])
def list_objects():
    """Получение списка объектов"""
    conn_id = session.get('conn_id')
    if not conn_id or conn_id not in connections:
        return jsonify({"success": False, "message": "Нет активного подключения"}), 401
    
    prefix = request.args.get('prefix', '')
    result = connections[conn_id].list_objects(prefix)
    return jsonify(result)

@app.route('/api/folder', methods=['POST'])
def create_folder():
    """Создание папки"""
    conn_id = session.get('conn_id')
    if not conn_id or conn_id not in connections:
        return jsonify({"success": False, "message": "Нет активного подключения"}), 401
    
    data = request.json
    result = connections[conn_id].create_folder(data['path'])
    return jsonify(result)

@app.route('/api/move', methods=['POST'])
def move_object():
    """Перемещение объекта в S3"""
    conn_id = session.get('conn_id')
    if not conn_id or conn_id not in connections:
        return jsonify({"success": False, "message": "Нет активного подключения"}), 401
    
    try:
        data = request.json
        source_path = data['source']
        destination_path = data['destination']
        
        handler = connections[conn_id]
        
        copy_result = handler.client.copy_object(
            Bucket=handler.current_bucket,
            CopySource={'Bucket': handler.current_bucket, 'Key': source_path},
            Key=destination_path
        )
        
        if copy_result:
            delete_result = handler.client.delete_object(
                Bucket=handler.current_bucket,
                Key=source_path
            )
            
            logger.info(f"Объект перемещен: {source_path} -> {destination_path}")
            return jsonify({"success": True, "message": "Объект перемещен"})
        else:
            return jsonify({"success": False, "message": "Ошибка копирования"}), 500
            
    except Exception as e:
        logger.error(f"Ошибка перемещения: {str(e)}")
        return jsonify({"success": False, "message": str(e)}), 500

@app.route('/api/upload', methods=['POST'])
def upload_file():
    """Загрузка файла с поддержкой больших файлов"""
    conn_id = session.get('conn_id')
    if not conn_id or conn_id not in connections:
        return jsonify({"success": False, "message": "Нет активного подключения"}), 401
    
    try:
        if 'file' not in request.files:
            return jsonify({"success": False, "message": "Файл не найден"}), 400
        
        file = request.files['file']
        path = request.form.get('path', '')
        
        # Логируем информацию о загружаемом файле
        file_size = file.content_length if hasattr(file, 'content_length') else 0
        logger.info(f"Загрузка файла: {file.filename}, размер: {file_size} байт")
        
        # Проверяем размер файла
        if file_size > app.config['MAX_CONTENT_LENGTH']:
            return jsonify({
                "success": False, 
                "message": f"Файл слишком большой. Максимальный размер: 10GB"
            }), 413
        
        # Формируем путь для сохранения
        if 'relativePath' in request.form:
            # Загрузка из папки с сохранением структуры
            relative_path = request.form['relativePath']
            file_path = path + relative_path
        else:
            # Обычная загрузка одного файла
            file_path = path + file.filename if path else file.filename
        
        # Загружаем файл чанками для больших файлов
        result = upload_large_file(connections[conn_id], file, file_path)
        
        if result['success']:
            logger.info(f"Файл успешно загружен: {file_path}")
            return jsonify(result)
        else:
            logger.error(f"Ошибка загрузки файла: {result['message']}")
            return jsonify(result), 500
            
    except Exception as e:
        logger.error(f"Ошибка загрузки: {str(e)}")
        return jsonify({"success": False, "message": str(e)}), 500

def upload_large_file(handler, file, file_path, chunk_size=10*1024*1024):  # 10MB чанки
    """Загрузка больших файлов чанками"""
    try:
        # Используем multipart upload для больших файлов
        if hasattr(file, 'content_length') and file.content_length > 100 * 1024 * 1024:  # > 100MB
            return handler.upload_file_multipart(file, file_path, chunk_size)
        else:
            # Для маленьких файлов используем обычную загрузку
            return handler.upload_file(file, file_path)
    except Exception as e:
        return {"success": False, "message": str(e)}

@app.route('/api/download/<path:file_path>')
def download_file(file_path):
    """Скачивание файла"""
    conn_id = session.get('conn_id')
    if not conn_id or conn_id not in connections:
        return jsonify({"success": False, "message": "Нет активного подключения"}), 401
    
    try:
        result = connections[conn_id].download_file(file_path)
        
        if result['success']:
            return send_file(
                io.BytesIO(result['data']),
                download_name=file_path.split('/')[-1],
                as_attachment=True
            )
        else:
            return jsonify(result), 500
    except Exception as e:
        logger.error(f"Ошибка скачивания: {str(e)}")
        return jsonify({"success": False, "message": str(e)}), 500

@app.route('/api/delete', methods=['POST'])
def delete_object():
    """Удаление объекта"""
    conn_id = session.get('conn_id')
    if not conn_id or conn_id not in connections:
        return jsonify({"success": False, "message": "Нет активного подключения"}), 401
    
    data = request.json
    result = connections[conn_id].delete_object(data['path'])
    return jsonify(result)

@app.route('/api/logs', methods=['GET'])
def get_logs():
    """Получение логов"""
    try:
        with open('/var/log/nginx/s3_manager.log', 'r') as f:
            logs = f.readlines()[-100:]  # Последние 100 строк
        return jsonify({"success": True, "logs": logs})
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True, threaded=True)