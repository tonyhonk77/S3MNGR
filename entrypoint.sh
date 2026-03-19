#!/bin/bash

# Запуск Flask приложения в фоне
cd /app
python app.py &

# Запуск Nginx
nginx -g "daemon off;"