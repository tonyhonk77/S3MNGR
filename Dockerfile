FROM python:3.9-slim

# Установка системных зависимостей
RUN apt-get update && apt-get install -y \
    nginx \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Создание директорий
RUN mkdir -p /app /var/www/html /var/log/nginx /data /app/profiles /tmp/nginx_client_body_temp

# Копирование файлов backend
COPY backend/ /app/
COPY frontend/ /var/www/html/
COPY nginx/default.conf /etc/nginx/sites-available/default

# Установка Python зависимостей
RUN pip install --no-cache-dir -r /app/requirements.txt

# Настройка прав
RUN chown -R www-data:www-data /var/www/html /data /app/profiles /tmp/nginx_client_body_temp \
    && chmod -R 755 /var/www/html /data /app/profiles /tmp/nginx_client_body_temp

# Копирование скрипта запуска
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 80

ENTRYPOINT ["/entrypoint.sh"]