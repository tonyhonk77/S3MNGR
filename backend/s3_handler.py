import boto3
from botocore.client import Config
from botocore.exceptions import ClientError
import logging
from urllib.parse import urlparse
import math

class S3Handler:
    def __init__(self):
        self.client = None
        self.current_bucket = None
        self.logger = logging.getLogger('s3_manager')
        
    def connect(self, endpoint, access_key, secret_key, bucket, use_ssl=True):
        """Подключение к S3"""
        try:
            # Парсинг endpoint
            parsed_url = urlparse(endpoint)
            endpoint_url = f"{parsed_url.scheme or 'https'}://{parsed_url.netloc or parsed_url.path}"
            
            # Создание клиента с увеличенными таймаутами
            self.client = boto3.client(
                's3',
                endpoint_url=endpoint_url,
                aws_access_key_id=access_key,
                aws_secret_access_key=secret_key,
                config=Config(
                    signature_version='s3v4',
                    connect_timeout=300,
                    read_timeout=300,
                    retries={'max_attempts': 3}
                ),
                verify=use_ssl
            )
            
            # Проверка подключения
            self.client.head_bucket(Bucket=bucket)
            self.current_bucket = bucket
            
            self.logger.info(f"Успешное подключение к {endpoint_url}/{bucket}")
            return {"success": True, "message": "Подключение успешно"}
            
        except ClientError as e:
            error_msg = str(e)
            self.logger.error(f"Ошибка подключения: {error_msg}")
            return {"success": False, "message": f"Ошибка подключения: {error_msg}"}
        except Exception as e:
            error_msg = str(e)
            self.logger.error(f"Неизвестная ошибка: {error_msg}")
            return {"success": False, "message": f"Неизвестная ошибка: {error_msg}"}
    
    def list_objects(self, prefix=''):
        """Получение списка объектов"""
        try:
            if not self.client:
                return {"success": False, "message": "Нет подключения"}
            
            paginator = self.client.get_paginator('list_objects_v2')
            pages = paginator.paginate(Bucket=self.current_bucket, Prefix=prefix, Delimiter='/')
            
            files = []
            folders = []
            
            for page in pages:
                # Добавление папок
                if 'CommonPrefixes' in page:
                    for prefix_obj in page['CommonPrefixes']:
                        folders.append({
                            'name': prefix_obj['Prefix'].rstrip('/').split('/')[-1],
                            'path': prefix_obj['Prefix'],
                            'type': 'folder'
                        })
                
                # Добавление файлов
                if 'Contents' in page:
                    for obj in page['Contents']:
                        if obj['Key'] != prefix:  # Исключаем текущую папку
                            files.append({
                                'name': obj['Key'].split('/')[-1],
                                'path': obj['Key'],
                                'size': obj['Size'],
                                'last_modified': obj['LastModified'].isoformat(),
                                'type': 'file'
                            })
            
            return {"success": True, "folders": folders, "files": files}
            
        except Exception as e:
            self.logger.error(f"Ошибка получения списка: {str(e)}")
            return {"success": False, "message": str(e)}
    
    def create_folder(self, folder_path):
        """Создание папки"""
        try:
            # Убеждаемся, что путь заканчивается на /
            if not folder_path.endswith('/'):
                folder_path += '/'
            
            self.client.put_object(Bucket=self.current_bucket, Key=folder_path)
            self.logger.info(f"Папка создана: {folder_path}")
            return {"success": True, "message": "Папка создана"}
            
        except Exception as e:
            self.logger.error(f"Ошибка создания папки: {str(e)}")
            return {"success": False, "message": str(e)}
    
    def upload_file(self, file_data, file_path):
        """Загрузка файла"""
        try:
            self.client.upload_fileobj(file_data, self.current_bucket, file_path)
            self.logger.info(f"Файл загружен: {file_path}")
            return {"success": True, "message": "Файл загружен"}
            
        except Exception as e:
            self.logger.error(f"Ошибка загрузки файла: {str(e)}")
            return {"success": False, "message": str(e)}
    
    def upload_file_multipart(self, file_data, file_path, chunk_size=10*1024*1024):
        """Загрузка больших файлов с использованием multipart upload"""
        try:
            # Инициируем multipart upload
            response = self.client.create_multipart_upload(
                Bucket=self.current_bucket,
                Key=file_path
            )
            upload_id = response['UploadId']
            
            parts = []
            part_number = 1
            
            # Читаем и загружаем чанки
            while True:
                chunk = file_data.read(chunk_size)
                if not chunk:
                    break
                
                # Загружаем часть
                part_response = self.client.upload_part(
                    Bucket=self.current_bucket,
                    Key=file_path,
                    PartNumber=part_number,
                    UploadId=upload_id,
                    Body=chunk
                )
                
                parts.append({
                    'ETag': part_response['ETag'],
                    'PartNumber': part_number
                })
                
                part_number += 1
                self.logger.info(f"Загружена часть {part_number-1} для {file_path}")
            
            # Завершаем multipart upload
            self.client.complete_multipart_upload(
                Bucket=self.current_bucket,
                Key=file_path,
                UploadId=upload_id,
                MultipartUpload={'Parts': parts}
            )
            
            self.logger.info(f"Файл загружен (multipart): {file_path}")
            return {"success": True, "message": "Файл загружен"}
            
        except Exception as e:
            # В случае ошибки отменяем загрузку
            try:
                self.client.abort_multipart_upload(
                    Bucket=self.current_bucket,
                    Key=file_path,
                    UploadId=upload_id
                )
            except:
                pass
            
            self.logger.error(f"Ошибка multipart загрузки: {str(e)}")
            return {"success": False, "message": str(e)}
    
    def download_file(self, file_path):
        """Скачивание файла"""
        try:
            response = self.client.get_object(Bucket=self.current_bucket, Key=file_path)
            self.logger.info(f"Файл скачан: {file_path}")
            return {"success": True, "data": response['Body'].read()}
            
        except Exception as e:
            self.logger.error(f"Ошибка скачивания файла: {str(e)}")
            return {"success": False, "message": str(e)}
    
    def delete_object(self, object_path):
        """Удаление объекта"""
        try:
            self.client.delete_object(Bucket=self.current_bucket, Key=object_path)
            self.logger.info(f"Объект удален: {object_path}")
            return {"success": True, "message": "Объект удален"}
            
        except Exception as e:
            self.logger.error(f"Ошибка удаления: {str(e)}")
            return {"success": False, "message": str(e)}
    
    def move_object(self, source_path, destination_path):
        """Перемещение объекта"""
        try:
            # Копируем объект
            copy_source = {'Bucket': self.current_bucket, 'Key': source_path}
            self.client.copy_object(
                Bucket=self.current_bucket,
                CopySource=copy_source,
                Key=destination_path
            )
            
            # Удаляем исходный объект
            self.client.delete_object(Bucket=self.current_bucket, Key=source_path)
            
            self.logger.info(f"Объект перемещен: {source_path} -> {destination_path}")
            return {"success": True, "message": "Объект перемещен"}
            
        except Exception as e:
            self.logger.error(f"Ошибка перемещения: {str(e)}")
            return {"success": False, "message": str(e)}