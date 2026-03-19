// Глобальные переменные
let currentPath = '';
let currentProfile = null;
let isConnected = false;
let selectedFiles = new Map(); // Хранит выбранные файлы {path: {name, size, type}}
let linkTemplate = ''; // Шаблон для генерации ссылок
let generatedLinks = []; // Сгенерированные ссылки для предпросмотра

// Переменные для drag & drop перемещения
let draggedItem = null;
let dragOverItem = null;
let dragTargetFolder = null;

// Переменные для прогресса
let uploadQueue = [];
let isUploading = false;
let downloadQueue = [];
let isDownloading = false;
let activeUploads = 0;
let totalUploadSize = 0;
let uploadedSize = 0;

// Загрузка профилей при старте
document.addEventListener('DOMContentLoaded', () => {
    loadProfiles();
    setupDragAndDrop();
    setupFileListDragAndDrop();
    loadLinkTemplate();
    setupUploadButtons();
    
    // Периодическое обновление логов
    setInterval(refreshLogs, 5000);
    
    // Добавляем обработчик для формы логина
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', (e) => {
            e.preventDefault();
            connect();
        });
    }
});

// Настройка кнопок загрузки
function setupUploadButtons() {
    const fileInput = document.getElementById('fileInput');
    const folderInput = document.getElementById('folderInput');
    
    document.getElementById('uploadFilesBtn').addEventListener('click', () => {
        fileInput.click();
    });
    
    document.getElementById('uploadFolderBtn').addEventListener('click', () => {
        folderInput.click();
    });
    
    fileInput.addEventListener('change', (e) => {
        const files = Array.from(e.target.files);
        if (files.length > 0) {
            uploadFiles(files);
        }
        fileInput.value = ''; // Очищаем для возможности повторного выбора
    });
    
    folderInput.addEventListener('change', (e) => {
        const files = Array.from(e.target.files);
        if (files.length > 0) {
            uploadFolder(files);
        }
        folderInput.value = ''; // Очищаем для возможности повторного выбора
    });
}

// Загрузка профилей
async function loadProfiles() {
    try {
        const response = await fetch('/api/profiles');
        const profiles = await response.json();
        
        const profilesList = document.getElementById('profilesList');
        profilesList.innerHTML = '';
        
        profiles.forEach(profile => {
            const profileElement = createProfileElement(profile);
            profilesList.appendChild(profileElement);
        });
    } catch (error) {
        showError('Ошибка загрузки профилей');
    }
}

// Создание элемента профиля
function createProfileElement(profile) {
    const div = document.createElement('div');
    div.className = `profile-item ${currentProfile?.id === profile.id ? 'selected' : ''}`;
    div.onclick = () => selectProfile(profile);
    
    div.innerHTML = `
        <div class="profile-name">${profile.name}</div>
        <div class="profile-details">${profile.endpoint} / ${profile.bucket}</div>
        <div class="profile-actions">
            <button onclick="event.stopPropagation(); deleteProfile('${profile.id}')" class="btn-delete">
                <i class="fas fa-trash"></i> Удалить
            </button>
        </div>
    `;
    
    return div;
}

// Выбор профиля
function selectProfile(profile) {
    currentProfile = profile;
    
    // Обновление UI
    document.querySelectorAll('.profile-item').forEach(el => {
        el.classList.remove('selected');
    });
    event.currentTarget.classList.add('selected');
    
    document.getElementById('selectedProfile').innerHTML = `
        <i class="fas fa-check-circle"></i> Выбран профиль: ${profile.name}
    `;
    
    // Обновляем атрибут name для поля username
    const accessKeyInput = document.getElementById('accessKey');
    if (accessKeyInput) {
        accessKeyInput.setAttribute('data-profile', profile.name);
    }
}

// Сохранение профиля
async function saveProfile() {
    const name = document.getElementById('profileName').value;
    const endpoint = document.getElementById('profileEndpoint').value;
    const bucket = document.getElementById('profileBucket').value;
    
    if (!name || !endpoint || !bucket) {
        alert('Заполните все поля');
        return;
    }
    
    try {
        const response = await fetch('/api/profiles', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({name, endpoint, bucket})
        });
        
        const result = await response.json();
        
        if (result.success) {
            document.getElementById('profileName').value = '';
            document.getElementById('profileEndpoint').value = '';
            document.getElementById('profileBucket').value = '';
            
            loadProfiles();
            showSuccess('Профиль сохранен');
        }
    } catch (error) {
        showError('Ошибка сохранения профиля');
    }
}

// Удаление профиля
async function deleteProfile(profileId) {
    if (!confirm('Удалить профиль?')) return;
    
    try {
        const response = await fetch(`/api/profiles/${profileId}`, {
            method: 'DELETE'
        });
        
        const result = await response.json();
        
        if (result.success) {
            if (currentProfile?.id === profileId) {
                currentProfile = null;
                document.getElementById('selectedProfile').innerHTML = '';
            }
            loadProfiles();
            showSuccess('Профиль удален');
        }
    } catch (error) {
        showError('Ошибка удаления профиля');
    }
}

// Подключение к S3
async function connect() {
    if (!currentProfile) {
        alert('Выберите профиль');
        return;
    }
    
    const accessKey = document.getElementById('accessKey').value;
    const secretKey = document.getElementById('secretKey').value;
    
    if (!accessKey || !secretKey) {
        alert('Введите ключи доступа');
        return;
    }
    
    try {
        const response = await fetch('/api/connect', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                ...currentProfile,
                access_key: accessKey,
                secret_key: secretKey,
                use_ssl: true
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            isConnected = true;
            
            document.getElementById('connectionStatus').innerHTML = '<i class="fas fa-plug"></i> Подключено';
            document.getElementById('connectionStatus').classList.add('connected');
            
            document.getElementById('connectBtn').style.display = 'none';
            document.getElementById('disconnectBtn').style.display = 'block';
            
            document.getElementById('accessKey').setAttribute('autocomplete', 'off');
            document.getElementById('secretKey').setAttribute('autocomplete', 'off');
            
            document.getElementById('linkBuilderSection').style.display = 'block';
            
            // Показываем контейнер с прогрессбарами
            document.getElementById('progressBarsContainer').style.display = 'block';
            
            loadFiles();
            showSuccess('Подключение успешно');
        } else {
            showError(result.message);
        }
    } catch (error) {
        showError('Ошибка подключения');
    }
}

// Отключение
async function disconnect() {
    if (!confirm('Отключиться от S3?')) return;
    
    try {
        const response = await fetch('/api/disconnect', {method: 'POST'});
        const result = await response.json();
        
        if (result.success) {
            isConnected = false;
            currentPath = '';
            selectedFiles.clear();
            updateSelectedCount();
            
            document.getElementById('connectionStatus').innerHTML = '<i class="fas fa-plug"></i> Не подключено';
            document.getElementById('connectionStatus').classList.remove('connected');
            
            document.getElementById('connectBtn').style.display = 'block';
            document.getElementById('disconnectBtn').style.display = 'none';
            
            document.getElementById('accessKey').setAttribute('autocomplete', 'username');
            document.getElementById('secretKey').setAttribute('autocomplete', 'current-password');
            
            document.getElementById('linkBuilderSection').style.display = 'none';
            document.getElementById('progressBarsContainer').style.display = 'none';
            
            document.getElementById('fileList').innerHTML = '';
            document.getElementById('currentPath').textContent = '/';
            document.getElementById('upButton').disabled = true;
            
            const selectAllCheckbox = document.getElementById('selectAll');
            if (selectAllCheckbox) {
                selectAllCheckbox.checked = false;
                selectAllCheckbox.indeterminate = false;
            }
            
            showSuccess('Отключено от S3');
        }
    } catch (error) {
        showError('Ошибка отключения');
    }
}

// Загрузка списка файлов
async function loadFiles() {
    if (!isConnected) return;
    
    try {
        const response = await fetch(`/api/list?prefix=${encodeURIComponent(currentPath)}`);
        const result = await response.json();
        
        if (result.success) {
            displayFiles(result.folders || [], result.files || []);
        } else {
            showError(result.message);
        }
    } catch (error) {
        showError('Ошибка загрузки списка файлов');
    }
}

// Отображение файлов
function displayFiles(folders, files) {
    const fileList = document.getElementById('fileList');
    fileList.innerHTML = '';
    
    folders.forEach(folder => {
        const folderElement = createFolderElement(folder);
        fileList.appendChild(folderElement);
    });
    
    files.forEach(file => {
        const fileElement = createFileElement(file);
        fileList.appendChild(fileElement);
    });
    
    document.getElementById('currentPath').textContent = '/' + currentPath;
    document.getElementById('upButton').disabled = currentPath === '';
    
    updateSelectAllState();
    document.getElementById('generateLinksBtn').disabled = selectedFiles.size === 0;
}

// Создание элемента папки
function createFolderElement(folder) {
    const div = document.createElement('div');
    div.className = 'file-item folder';
    div.setAttribute('draggable', 'true');
    div.setAttribute('data-path', folder.path);
    div.setAttribute('data-name', folder.name);
    div.setAttribute('data-type', 'folder');
    div.ondblclick = () => navigateToFolder(folder.path);
    
    const isSelected = selectedFiles.has(folder.path);
    if (isSelected) {
        div.classList.add('selected');
    }
    
    div.innerHTML = `
        <div class="file-checkbox">
            <input type="checkbox" 
                   data-path="${folder.path}"
                   onchange="toggleFileSelection('${folder.path}', this.checked, {name: '${folder.name}', type: 'folder'})"
                   ${isSelected ? 'checked' : ''}>
        </div>
        <div class="file-name" onclick="navigateToFolder('${folder.path}')">
            <i class="fas fa-folder"></i>
            ${folder.name}
        </div>
        <div>-</div>
        <div>-</div>
        <div class="file-actions">
            <button onclick="event.stopPropagation(); navigateToFolder('${folder.path}')" title="Открыть">
                <i class="fas fa-folder-open"></i>
            </button>
            <button onclick="event.stopPropagation(); deleteObject('${folder.path}')" class="delete" title="Удалить">
                <i class="fas fa-trash"></i>
            </button>
        </div>
    `;
    
    return div;
}

// Создание элемента файла
function createFileElement(file) {
    const div = document.createElement('div');
    div.className = 'file-item';
    div.setAttribute('draggable', 'true');
    div.setAttribute('data-path', file.path);
    div.setAttribute('data-name', file.name);
    div.setAttribute('data-type', 'file');
    
    const isSelected = selectedFiles.has(file.path);
    if (isSelected) {
        div.classList.add('selected');
    }
    
    const size = formatFileSize(file.size);
    const date = new Date(file.last_modified).toLocaleString();
    
    const decodedName = decodePunycode(file.name);
    
    div.innerHTML = `
        <div class="file-checkbox">
            <input type="checkbox" 
                   data-path="${file.path}"
                   onchange="toggleFileSelection('${file.path}', this.checked, {name: '${file.name}', decodedName: '${decodedName}', size: ${file.size}, type: 'file'})"
                   ${isSelected ? 'checked' : ''}>
        </div>
        <div class="file-name">
            <i class="fas fa-file"></i>
            ${decodedName}
            ${file.name !== decodedName ? `<small class="punycode-original">(${file.name})</small>` : ''}
        </div>
        <div>${size}</div>
        <div>${date}</div>
        <div class="file-actions">
            <button onclick="downloadFile('${file.path}', ${file.size})" title="Скачать">
                <i class="fas fa-download"></i>
            </button>
            <button onclick="deleteObject('${file.path}')" class="delete" title="Удалить">
                <i class="fas fa-trash"></i>
            </button>
        </div>
    `;
    
    return div;
}

// Загрузка файлов (поддерживаются все типы)
async function uploadFiles(files) {
    if (!isConnected) {
        alert('Сначала подключитесь к S3');
        return;
    }
    
    // Сбрасываем счетчики
    totalUploadSize = 0;
    uploadedSize = 0;
    
    // Добавляем файлы в очередь и подсчитываем общий размер
    for (const file of files) {
        uploadQueue.push({
            file: file,
            path: currentPath,
            name: file.name,
            size: file.size,
            type: file.type || 'application/octet-stream'
        });
        totalUploadSize += file.size;
    }
    
    updateQueueCount();
    showUploadProgress(true);
    updateUploadStatus(`Подготовка к загрузке ${files.length} файлов...`, 0);
    
    if (!isUploading) {
        processUploadQueue();
    }
}

// Загрузка папки
async function uploadFolder(files) {
    if (!isConnected) {
        alert('Сначала подключитесь к S3');
        return;
    }
    
    const fileList = [];
    totalUploadSize = 0;
    uploadedSize = 0;
    
    for (let file of files) {
        const relativePath = file.webkitRelativePath || file.name;
        fileList.push({
            file: file,
            path: currentPath,
            relativePath: relativePath,
            name: file.name,
            size: file.size,
            type: file.type || 'application/octet-stream'
        });
        totalUploadSize += file.size;
    }
    
    // Сортируем, чтобы сначала создавались папки
    fileList.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
    
    for (const fileInfo of fileList) {
        uploadQueue.push(fileInfo);
    }
    
    updateQueueCount();
    showUploadProgress(true);
    updateUploadStatus(`Подготовка к загрузке папки (${fileList.length} файлов)...`, 0);
    
    if (!isUploading) {
        processUploadQueue();
    }
}

// Обработка очереди загрузки с реальным прогрессом
async function processUploadQueue() {
    if (uploadQueue.length === 0 || !isConnected) {
        isUploading = false;
        setTimeout(() => {
            showUploadProgress(false);
            // Обновляем список файлов после завершения всех загрузок
            loadFiles();
        }, 2000);
        return;
    }
    
    isUploading = true;
    
    const fileInfo = uploadQueue[0];
    const file = fileInfo.file;
    const filePath = fileInfo.relativePath ? 
        currentPath + fileInfo.relativePath : 
        currentPath + fileInfo.name;
    
    try {
        updateUploadStatus(`Загрузка: ${fileInfo.name}`, 
            Math.round((uploadedSize / totalUploadSize) * 100));
        
        const formData = new FormData();
        formData.append('file', file);
        formData.append('path', currentPath);
        if (fileInfo.relativePath) {
            formData.append('relativePath', fileInfo.relativePath);
        }
        
        // Создаем XHR для отслеживания прогресса
        const xhr = new XMLHttpRequest();
        
        // Отслеживание прогресса загрузки текущего файла
        xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) {
                const fileProgress = e.loaded / e.total;
                const currentFileUploaded = e.loaded;
                
                // Общий прогресс = уже загруженное + прогресс текущего файла
                const totalProgress = ((uploadedSize + currentFileUploaded) / totalUploadSize) * 100;
                
                const speed = e.loaded / ((Date.now() - startTime) / 1000);
                
                updateUploadProgress(
                    Math.round(totalProgress),
                    fileInfo.name,
                    formatSpeed(speed),
                    formatFileSize(uploadedSize + e.loaded),
                    formatFileSize(totalUploadSize)
                );
            }
        });
        
        const startTime = Date.now();
        
        // Ждем завершения загрузки
        const response = await new Promise((resolve, reject) => {
            xhr.onload = () => {
                if (xhr.status === 200) {
                    try {
                        resolve(JSON.parse(xhr.response));
                    } catch (e) {
                        resolve({ success: true });
                    }
                } else {
                    reject(new Error(`HTTP ${xhr.status}`));
                }
            };
            xhr.onerror = () => reject(new Error('Network error'));
            xhr.open('POST', '/api/upload');
            xhr.send(formData);
        });
        
        if (response.success) {
            // Обновляем счетчики
            uploadedSize += file.size;
            showSuccess(`Файл ${fileInfo.name} загружен`);
            uploadQueue.shift(); // Удаляем из очереди
            updateQueueCount();
            
            // Немедленно обновляем список файлов после каждого успешно загруженного файла
            await loadFiles();
            
            // Обновляем прогресс
            if (uploadQueue.length > 0) {
                const nextFile = uploadQueue[0];
                const progress = Math.round((uploadedSize / totalUploadSize) * 100);
                updateUploadStatus(`Загрузка: ${nextFile.name}`, progress);
            } else {
                updateUploadStatus('Загрузка завершена', 100);
                // Обновляем список еще раз после завершения всех загрузок
                await loadFiles();
                setTimeout(() => {
                    showUploadProgress(false);
                }, 2000);
            }
            
            // Загружаем следующий файл
            processUploadQueue();
        } else {
            throw new Error(response.message || 'Ошибка загрузки');
        }
    } catch (error) {
        console.error('Upload error:', error);
        showError(`Ошибка загрузки ${fileInfo.name}: ${error.message}`);
        uploadQueue.shift(); // Удаляем проблемный файл из очереди
        updateQueueCount();
        
        // Обновляем прогресс
        if (uploadQueue.length > 0) {
            const progress = Math.round((uploadedSize / totalUploadSize) * 100);
            updateUploadStatus(`Ошибка, продолжаем...`, progress);
        }
        
        processUploadQueue(); // Продолжаем со следующим
    }
}

// Скачивание файла с прогрессом
async function downloadFile(filePath, fileSize) {
    if (!isConnected) {
        alert('Сначала подключитесь к S3');
        return;
    }
    
    const fileName = filePath.split('/').pop();
    
    try {
        showDownloadProgress(true);
        updateDownloadStatus(`Скачивание: ${fileName}`, 0);
        
        const xhr = new XMLHttpRequest();
        xhr.responseType = 'blob';
        
        const startTime = Date.now();
        
        xhr.addEventListener('progress', (e) => {
            if (e.lengthComputable) {
                const percent = Math.round((e.loaded / e.total) * 100);
                const speed = e.loaded / ((Date.now() - startTime) / 1000);
                updateDownloadProgress(
                    percent, 
                    fileName, 
                    formatSpeed(speed),
                    formatFileSize(e.loaded),
                    formatFileSize(e.total)
                );
            }
        });
        
        xhr.addEventListener('load', () => {
            if (xhr.status === 200) {
                // Создаем ссылку для скачивания
                const blob = xhr.response;
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = fileName;
                document.body.appendChild(a);
                a.click();
                window.URL.revokeObjectURL(url);
                document.body.removeChild(a);
                
                updateDownloadStatus('Скачивание завершено', 100);
                setTimeout(() => {
                    showDownloadProgress(false);
                }, 2000);
                
                showSuccess(`Файл ${fileName} скачан`);
            } else {
                showError(`Ошибка скачивания ${fileName}`);
                showDownloadProgress(false);
            }
        });
        
        xhr.addEventListener('error', () => {
            showError(`Ошибка скачивания ${fileName}`);
            showDownloadProgress(false);
        });
        
        xhr.open('GET', `/api/download/${encodeURIComponent(filePath)}`);
        xhr.send();
        
    } catch (error) {
        console.error('Download error:', error);
        showError(`Ошибка скачивания ${fileName}`);
        showDownloadProgress(false);
    }
}

// Форматирование скорости
function formatSpeed(bytesPerSecond) {
    if (bytesPerSecond < 1024) return `${Math.round(bytesPerSecond)} B/s`;
    if (bytesPerSecond < 1024 * 1024) return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
    return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`;
}

// Обновление прогресса загрузки
function showUploadProgress(show) {
    const progressEl = document.getElementById('uploadProgress');
    if (progressEl) {
        progressEl.style.display = show ? 'block' : 'none';
    }
}

function updateUploadProgress(percent, fileName, speed, uploaded, total) {
    const fillEl = document.getElementById('uploadProgressFill');
    const statusEl = document.getElementById('uploadStatus');
    const detailsEl = document.getElementById('uploadDetails');
    const speedEl = document.getElementById('uploadSpeed');
    
    if (fillEl) fillEl.style.width = percent + '%';
    if (statusEl) statusEl.textContent = `Загрузка: ${percent}% (${uploaded} / ${total})`;
    if (detailsEl) detailsEl.textContent = fileName;
    if (speedEl) speedEl.textContent = speed;
}

function updateUploadStatus(status, percent) {
    const fillEl = document.getElementById('uploadProgressFill');
    const statusEl = document.getElementById('uploadStatus');
    const detailsEl = document.getElementById('uploadDetails');
    const speedEl = document.getElementById('uploadSpeed');
    
    if (fillEl) fillEl.style.width = percent + '%';
    if (statusEl) statusEl.textContent = status;
    if (detailsEl) detailsEl.textContent = '';
    if (speedEl) speedEl.textContent = '0 KB/s';
}

// Обновление прогресса скачивания
function showDownloadProgress(show) {
    const progressEl = document.getElementById('downloadProgress');
    if (progressEl) {
        progressEl.style.display = show ? 'block' : 'none';
    }
}

function updateDownloadProgress(percent, fileName, speed, downloaded, total) {
    const fillEl = document.getElementById('downloadProgressFill');
    const statusEl = document.getElementById('downloadStatus');
    const detailsEl = document.getElementById('downloadDetails');
    const speedEl = document.getElementById('downloadSpeed');
    
    if (fillEl) fillEl.style.width = percent + '%';
    if (statusEl) statusEl.textContent = `Скачивание: ${percent}% (${downloaded} / ${total})`;
    if (detailsEl) detailsEl.textContent = fileName;
    if (speedEl) speedEl.textContent = speed;
}

function updateDownloadStatus(status, percent) {
    const fillEl = document.getElementById('downloadProgressFill');
    const statusEl = document.getElementById('downloadStatus');
    const detailsEl = document.getElementById('downloadDetails');
    const speedEl = document.getElementById('downloadSpeed');
    
    if (fillEl) fillEl.style.width = percent + '%';
    if (statusEl) statusEl.textContent = status;
    if (detailsEl) detailsEl.textContent = '';
    if (speedEl) speedEl.textContent = '0 KB/s';
}

// Обновление счетчика очереди
function updateQueueCount() {
    const queueEl = document.getElementById('queueCount');
    const queueInfoEl = document.getElementById('queueInfo');
    
    if (queueEl) {
        queueEl.textContent = uploadQueue.length;
        queueInfoEl.style.display = uploadQueue.length > 1 ? 'flex' : 'none';
    }
}

// Настройка drag and drop для перемещения файлов внутри списка
function setupFileListDragAndDrop() {
    const fileList = document.getElementById('fileList');
    
    fileList.addEventListener('dragstart', handleDragStart);
    fileList.addEventListener('dragend', handleDragEnd);
    fileList.addEventListener('dragover', handleDragOver);
    fileList.addEventListener('dragleave', handleDragLeave);
    fileList.addEventListener('drop', handleDrop);
}

function handleDragStart(e) {
    const item = e.target.closest('.file-item');
    if (!item) return;
    
    draggedItem = item;
    item.classList.add('dragging');
    
    e.dataTransfer.setData('text/plain', item.dataset.path);
    e.dataTransfer.effectAllowed = 'move';
}

function handleDragEnd(e) {
    const item = e.target.closest('.file-item');
    if (item) {
        item.classList.remove('dragging');
    }
    
    document.querySelectorAll('.file-item').forEach(el => {
        el.classList.remove('drag-over', 'drag-over-bottom');
    });
    
    draggedItem = null;
    dragOverItem = null;
}

function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    
    const targetItem = e.target.closest('.file-item');
    if (!targetItem || targetItem === draggedItem) return;
    
    const rect = targetItem.getBoundingClientRect();
    const midpoint = rect.top + rect.height / 2;
    const isBelow = e.clientY > midpoint;
    
    document.querySelectorAll('.file-item').forEach(el => {
        el.classList.remove('drag-over', 'drag-over-bottom');
    });
    
    if (isBelow) {
        targetItem.classList.add('drag-over-bottom');
    } else {
        targetItem.classList.add('drag-over');
    }
    
    dragOverItem = targetItem;
    dragTargetFolder = targetItem.dataset.type === 'folder' ? targetItem.dataset.path : null;
}

function handleDragLeave(e) {
    const targetItem = e.target.closest('.file-item');
    if (targetItem) {
        targetItem.classList.remove('drag-over', 'drag-over-bottom');
    }
}

async function handleDrop(e) {
    e.preventDefault();
    
    const targetItem = e.target.closest('.file-item');
    if (!targetItem || !draggedItem) return;
    
    const sourcePath = draggedItem.dataset.path;
    const targetPath = targetItem.dataset.path;
    
    let destinationFolder;
    if (targetItem.dataset.type === 'folder') {
        destinationFolder = targetPath;
    } else {
        destinationFolder = currentPath;
    }
    
    const fileName = sourcePath.split('/').pop();
    const destinationPath = destinationFolder + fileName;
    
    if (sourcePath === destinationPath) {
        showError('Нельзя переместить файл в ту же папку');
        return;
    }
    
    showMoveConfirmation([sourcePath], destinationFolder);
    
    document.querySelectorAll('.file-item').forEach(el => {
        el.classList.remove('drag-over', 'drag-over-bottom');
    });
}

// Показать подтверждение перемещения
function showMoveConfirmation(items, destinationFolder) {
    const moveModal = document.getElementById('moveModal');
    const moveMessage = document.getElementById('moveMessage');
    const previewDiv = document.getElementById('selectedItemsPreview');
    
    const destinationDisplay = destinationFolder || 'корень';
    moveMessage.innerHTML = `Переместить в папку: <strong>${destinationDisplay}</strong>`;
    
    previewDiv.innerHTML = '';
    items.forEach(path => {
        const fileName = path.split('/').pop();
        const div = document.createElement('div');
        div.innerHTML = `<i class="fas fa-${path.includes('/') ? 'file' : 'folder'}"></i> ${fileName}`;
        previewDiv.appendChild(div);
    });
    
    window.moveData = {
        items: items,
        destination: destinationFolder
    };
    
    moveModal.style.display = 'block';
}

// Подтверждение перемещения
async function confirmMove() {
    if (!window.moveData) return;
    
    const { items, destination } = window.moveData;
    let successCount = 0;
    let errorCount = 0;
    
    for (const sourcePath of items) {
        const fileName = sourcePath.split('/').pop();
        const destinationPath = destination + fileName;
        
        try {
            const response = await fetch('/api/move', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    source: sourcePath,
                    destination: destinationPath
                })
            });
            
            const result = await response.json();
            
            if (result.success) {
                successCount++;
                if (selectedFiles.has(sourcePath)) {
                    selectedFiles.delete(sourcePath);
                }
            } else {
                errorCount++;
                console.error(`Ошибка перемещения ${sourcePath}:`, result.message);
            }
        } catch (error) {
            errorCount++;
            console.error(`Ошибка перемещения ${sourcePath}:`, error);
        }
    }
    
    if (successCount > 0) {
        showSuccess(`Перемещено: ${successCount} элементов`);
    }
    if (errorCount > 0) {
        showError(`Ошибок: ${errorCount}`);
    }
    
    loadFiles();
    updateSelectedCount();
    cancelMove();
}

// Отмена перемещения
function cancelMove() {
    document.getElementById('moveModal').style.display = 'none';
    window.moveData = null;
}

// Декодирование punycode
function decodePunycode(str) {
    try {
        if (str.includes('xn--')) {
            try {
                return decodeURIComponent(escape(str));
            } catch (e) {
                return str;
            }
        }
        return str;
    } catch (e) {
        return str;
    }
}

// Переключение выбора файла
function toggleFileSelection(path, checked, fileInfo) {
    if (checked) {
        selectedFiles.set(path, fileInfo);
    } else {
        selectedFiles.delete(path);
    }
    
    const fileItem = event?.target?.closest('.file-item');
    if (fileItem) {
        if (checked) {
            fileItem.classList.add('selected');
        } else {
            fileItem.classList.remove('selected');
        }
    }
    
    updateSelectedCount();
    updateSelectAllState();
    document.getElementById('generateLinksBtn').disabled = selectedFiles.size === 0;
}

// Выбрать все файлы
function toggleSelectAll(checked) {
    const checkboxes = document.querySelectorAll('.file-checkbox input[type="checkbox"]');
    
    checkboxes.forEach((checkbox) => {
        if (!checkbox.disabled) {
            checkbox.checked = checked;
            
            const path = checkbox.getAttribute('data-path');
            if (path) {
                if (checked) {
                    const fileItem = checkbox.closest('.file-item');
                    const nameElement = fileItem?.querySelector('.file-name');
                    const name = nameElement?.textContent.trim() || 'unknown';
                    const type = fileItem?.classList.contains('folder') ? 'folder' : 'file';
                    
                    selectedFiles.set(path, {name, type});
                } else {
                    selectedFiles.delete(path);
                }
            }
        }
    });
    
    updateSelectedCount();
    document.getElementById('generateLinksBtn').disabled = selectedFiles.size === 0;
}

// Обновление состояния чекбокса "Выбрать все"
function updateSelectAllState() {
    const checkboxes = document.querySelectorAll('.file-checkbox input[type="checkbox"]:not(:disabled)');
    const selectAllCheckbox = document.getElementById('selectAll');
    
    if (selectAllCheckbox) {
        const checkedCount = document.querySelectorAll('.file-checkbox input[type="checkbox"]:checked').length;
        selectAllCheckbox.checked = checkedCount === checkboxes.length && checkboxes.length > 0;
        selectAllCheckbox.indeterminate = checkedCount > 0 && checkedCount < checkboxes.length;
    }
}

// Очистка выбора
function clearSelection() {
    selectedFiles.clear();
    
    document.querySelectorAll('.file-checkbox input[type="checkbox"]').forEach(cb => {
        cb.checked = false;
    });
    
    document.querySelectorAll('.file-item').forEach(item => {
        item.classList.remove('selected');
    });
    
    updateSelectedCount();
    document.getElementById('generateLinksBtn').disabled = true;
    document.getElementById('selectAll').checked = false;
    document.getElementById('selectAll').indeterminate = false;
}

// Обновление счетчика выбранных файлов
function updateSelectedCount() {
    document.getElementById('selectedCount').textContent = selectedFiles.size;
}

// Загрузка сохраненного шаблона ссылок
function loadLinkTemplate() {
    const saved = localStorage.getItem('s3_link_template');
    if (saved) {
        document.getElementById('linkTemplate').value = saved;
        linkTemplate = saved;
    } else {
        const defaultTemplate = 'https://{bucket}.s3.amazonaws.com/{file}{filename}';
        document.getElementById('linkTemplate').value = defaultTemplate;
        linkTemplate = defaultTemplate;
    }
}

// Сохранение шаблона ссылок
function saveLinkTemplate() {
    linkTemplate = document.getElementById('linkTemplate').value;
    localStorage.setItem('s3_link_template', linkTemplate);
    showSuccess('Шаблон сохранен');
}

// Проверка шаблона на примере с punycode
function testLinkTemplate() {
    if (!isConnected || selectedFiles.size === 0) {
        alert('Сначала выберите файлы');
        return;
    }
    
    const firstFile = Array.from(selectedFiles.entries())[0];
    if (!firstFile) return;
    
    const [path, fileInfo] = firstFile;
    
    const pathParts = path.split('/');
    const fileName = pathParts.pop();
    const fileNameWithoutExt = fileName.substring(0, fileName.lastIndexOf('.')) || fileName;
    const fileExt = fileName.includes('.') ? fileName.substring(fileName.lastIndexOf('.')) : '';
    const folderPath = pathParts.length > 0 ? pathParts.join('/') + '/' : '';
    
    const template = document.getElementById('linkTemplate').value;
    
    // Кодируем в punycode для примера
    const encodeSegment = (segment) => {
        try {
            if (/^[\x00-\x7F]*$/.test(segment)) {
                return encodeURIComponent(segment);
            }
            return encodeURIComponent(segment);
        } catch (e) {
            return encodeURIComponent(segment);
        }
    };
    
    const encodedFolderPath = folderPath ? folderPath.split('/').filter(s => s).map(s => encodeSegment(s)).join('/') + '/' : '';
    const encodedFileName = encodeSegment(fileName);
    const encodedFileNameWithoutExt = encodeSegment(fileNameWithoutExt);
    const encodedExt = encodeURIComponent(fileExt);
    const decodedFileName = fileInfo.decodedName || decodePunycode(fileName);
    
    let example = template
        .replace(/{file}/g, encodedFolderPath)
        .replace(/{fullpath}/g, encodedFolderPath + encodedFileName)
        .replace(/{filename}/g, encodedFileName)
        .replace(/{filename_without_ext}/g, encodedFileNameWithoutExt)
        .replace(/{ext}/g, encodedExt)
        .replace(/{decoded_filename}/g, encodeURIComponent(decodedFileName))
        .replace(/{decoded_filename_without_ext}/g, encodeURIComponent(decodedFileName.replace(/\.[^/.]+$/, '')))
        .replace(/{bucket}/g, currentProfile?.bucket || '')
        .replace(/{endpoint}/g, currentProfile?.endpoint || '')
        .replace(/{dirname}/g, encodedFolderPath);
    
    alert(`Пример ссылки для файла "${fileName}" в punycode:\n\n${example}`);
}

// Генерация ссылок с punycode
function generateLinks() {
    if (selectedFiles.size === 0) {
        alert('Выберите файлы для генерации ссылок');
        return;
    }
    
    if (!linkTemplate) {
        linkTemplate = document.getElementById('linkTemplate').value;
        if (!linkTemplate) {
            alert('Введите шаблон ссылки');
            return;
        }
    }
    
    generatedLinks = [];
    const previewContent = document.getElementById('previewContent');
    previewContent.innerHTML = '<div class="loading"><i class="fas fa-spinner"></i> Генерация ссылок...</div>';
    
    document.getElementById('previewModal').style.display = 'block';
    
    setTimeout(() => {
        generateLinksFromSelection();
    }, 100);
}

// Генерация ссылок из выбранных файлов с punycode
function generateLinksFromSelection() {
    generatedLinks = [];
    
    selectedFiles.forEach((fileInfo, path) => {
        if (fileInfo.type === 'folder') return;
        
        // Разбираем путь на компоненты
        const pathParts = path.split('/');
        const fileName = pathParts.pop(); // Имя файла с расширением
        const fileNameWithoutExt = fileName.substring(0, fileName.lastIndexOf('.')) || fileName;
        const fileExt = fileName.includes('.') ? fileName.substring(fileName.lastIndexOf('.')) : '';
        
        // Путь к папке (со слешами, без имени файла)
        let folderPath = '';
        if (pathParts.length > 0) {
            folderPath = pathParts.join('/');
            if (!folderPath.endsWith('/')) {
                folderPath += '/';
            }
        }
        
        // Декодированное имя для отображения в таблице
        const decodedFileName = fileInfo.decodedName || decodePunycode(fileName);
        
        // Преобразуем нелатинские символы в punycode для URL
        const encodeSegment = (segment) => {
            try {
                // Проверяем, содержит ли сегмент только ASCII
                if (/^[\x00-\x7F]*$/.test(segment)) {
                    return encodeURIComponent(segment);
                }
                // Для не-ASCII используем encodeURIComponent
                return encodeURIComponent(segment);
            } catch (e) {
                return encodeURIComponent(segment);
            }
        };
        
        // Кодируем путь для ссылки (punycode)
        let encodedFolderPath = '';
        if (folderPath) {
            const folderSegments = folderPath.split('/').filter(s => s);
            const encodedSegments = folderSegments.map(s => encodeSegment(s));
            encodedFolderPath = encodedSegments.join('/') + '/';
        }
        
        // Кодируем имя файла для ссылки (punycode)
        let encodedFileName = encodeSegment(fileName);
        
        // Кодируем имя файла без расширения
        let encodedFileNameWithoutExt = encodeSegment(fileNameWithoutExt);
        
        // Кодируем расширение отдельно (оно обычно ASCII)
        let encodedExt = encodeURIComponent(fileExt);
        
        // Формируем полный закодированный путь
        let encodedFullPath = '';
        if (folderPath) {
            encodedFullPath = encodedFolderPath + encodedFileName;
        } else {
            encodedFullPath = encodedFileName;
        }
        
        // Заменяем переменные в шаблоне
        let link = linkTemplate
            // Путь к папке без имени файла (в punycode)
            .replace(/{file}/g, encodedFolderPath)
            // Полный путь с именем файла (в punycode)
            .replace(/{fullpath}/g, encodedFullPath)
            // Только имя файла с расширением (в punycode)
            .replace(/{filename}/g, encodedFileName)
            // Имя файла без расширения (в punycode)
            .replace(/{filename_without_ext}/g, encodedFileNameWithoutExt)
            // Расширение файла (с точкой)
            .replace(/{ext}/g, encodedExt)
            // Декодированное имя файла (для отображения)
            .replace(/{decoded_filename}/g, encodeURIComponent(decodedFileName))
            // Декодированное имя без расширения
            .replace(/{decoded_filename_without_ext}/g, encodeURIComponent(decodedFileName.replace(/\.[^/.]+$/, '')))
            // Имя бакета
            .replace(/{bucket}/g, currentProfile?.bucket || '')
            // Эндпоинт
            .replace(/{endpoint}/g, currentProfile?.endpoint || '')
            // Путь к папке (в punycode)
            .replace(/{dirname}/g, encodedFolderPath);
        
        // Не декодируем обратно, оставляем в punycode для ссылок
        
        generatedLinks.push({
            originalName: fileName,
            decodedName: decodedFileName,
            punycodeName: encodedFileName,
            path: path,
            punycodePath: encodedFullPath,
            folderPath: folderPath,
            punycodeFolderPath: encodedFolderPath,
            link: link
        });
    });
    
    displayPreview();
}

// Отображение предпросмотра ссылок с punycode
function displayPreview() {
    const previewContent = document.getElementById('previewContent');
    
    if (generatedLinks.length === 0) {
        previewContent.innerHTML = '<p class="no-data">Нет файлов для генерации ссылок</p>';
        return;
    }
    
    let html = `
        <table class="preview-table">
            <thead>
                <tr>
                    <th>Имя файла</th>
                    <th>Ссылка (punycode)</th>
                </tr>
            </thead>
            <tbody>
    `;
    
    generatedLinks.forEach(item => {
        const fullPathDisplay = item.folderPath ? item.folderPath + item.originalName : item.originalName;
        const punycodeDisplay = item.punycodeFolderPath + item.punycodeName;
        
        html += `
            <tr>
                <td class="preview-filename" title="${item.originalName}">
                    ${item.decodedName}
                    ${item.originalName !== item.decodedName ? `<small>(${item.originalName})</small>` : ''}
                    <div class="preview-fullpath">${fullPathDisplay}</div>
                    <div class="preview-punycode">Punycode: ${punycodeDisplay}</div>
                </td>
                <td class="preview-link">
                    <a href="${item.link}" target="_blank">${item.link}</a>
                </td>
            </tr>
        `;
    });
    
    html += `
            </tbody>
        </table>
    `;
    
    previewContent.innerHTML = html;
}

// Скачивание CSV файла с punycode ссылками
function downloadCsv() {
    if (generatedLinks.length === 0) {
        alert('Нет сгенерированных ссылок');
        return;
    }
    
    // Создаем содержимое CSV с BOM для UTF-8
    let csvContent = '\uFEFFИмя файла;Путь (punycode);Ссылка (punycode)\n';
    
    generatedLinks.forEach(item => {
        // Экранируем кавычки и точки с запятой
        const escapedName = item.decodedName.replace(/"/g, '""');
        const escapedPunycodePath = item.punycodePath.replace(/"/g, '""');
        csvContent += `"${escapedName}";"${escapedPunycodePath}";${item.link}\n`;
    });
    
    // Создаем и скачиваем файл
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    const timestamp = new Date().toISOString().slice(0,19).replace(/:/g, '-');
    link.href = url;
    link.setAttribute('download', `s3_links_punycode_${timestamp}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    showSuccess(`CSV файл с punycode ссылками создан (${generatedLinks.length} ссылок)`);
    
    // Закрываем модальное окно через секунду
    setTimeout(() => {
        closePreviewModal();
    }, 1000);
}

// Закрытие модального окна предпросмотра
function closePreviewModal() {
    document.getElementById('previewModal').style.display = 'none';
}

// Навигация по папкам
function navigateToFolder(folderPath) {
    currentPath = folderPath;
    loadFiles();
}

// Переход вверх
function goUp() {
    if (!currentPath) return;
    
    const parts = currentPath.split('/').filter(p => p);
    parts.pop();
    currentPath = parts.length ? parts.join('/') + '/' : '';
    loadFiles();
}

// Форматирование размера файла
function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Настройка drag and drop для загрузки файлов и папок
function setupDragAndDrop() {
    const dropZone = document.getElementById('dropZone');
    
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });
    
    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('dragover');
    });
    
    dropZone.addEventListener('drop', async (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        
        const items = e.dataTransfer.items;
        if (!items) return;
        
        let hasFolders = false;
        const files = [];
        
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.kind === 'file') {
                const entry = item.webkitGetAsEntry();
                if (entry && entry.isDirectory) {
                    hasFolders = true;
                    break;
                } else {
                    const file = item.getAsFile();
                    if (file) {
                        files.push(file);
                    }
                }
            }
        }
        
        if (hasFolders) {
            await handleDroppedFolders(items);
        } else if (files.length > 0) {
            await uploadFiles(files);
        }
    });
}

// Обработка перетаскивания папок
async function handleDroppedFolders(items) {
    const fileEntries = [];
    
    for (let i = 0; i < items.length; i++) {
        const entry = items[i].webkitGetAsEntry();
        if (entry) {
            await traverseFileTree(entry, '', fileEntries);
        }
    }
    
    if (fileEntries.length > 0) {
        const files = fileEntries.map(item => item.file);
        await uploadFolder(files);
    }
}

// Рекурсивный обход дерева файлов
function traverseFileTree(entry, path, result) {
    return new Promise((resolve) => {
        if (entry.isFile) {
            entry.file((file) => {
                // Сохраняем относительный путь
                Object.defineProperty(file, 'webkitRelativePath', {
                    value: path + file.name,
                    writable: false
                });
                result.push({ file, path });
                resolve();
            });
        } else if (entry.isDirectory) {
            const dirReader = entry.createReader();
            dirReader.readEntries(async (entries) => {
                for (const subEntry of entries) {
                    await traverseFileTree(subEntry, path + entry.name + '/', result);
                }
                resolve();
            });
        } else {
            resolve();
        }
    });
}

// Удаление объекта
async function deleteObject(objectPath) {
    if (!confirm('Удалить объект?')) return;
    
    try {
        const response = await fetch('/api/delete', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({path: objectPath})
        });
        
        const result = await response.json();
        
        if (result.success) {
            showSuccess('Объект удален');
            if (selectedFiles.has(objectPath)) {
                selectedFiles.delete(objectPath);
                updateSelectedCount();
            }
            loadFiles();
        } else {
            showError(result.message);
        }
    } catch (error) {
        showError('Ошибка удаления');
    }
}

// Создание папки
function createFolder() {
    if (!isConnected) {
        alert('Сначала подключитесь к S3');
        return;
    }
    
    document.getElementById('folderModal').style.display = 'block';
    document.getElementById('newFolderName').value = '';
}

// Подтверждение создания папки
async function createFolderConfirm() {
    const folderName = document.getElementById('newFolderName').value;
    
    if (!folderName) {
        alert('Введите название папки');
        return;
    }
    
    const folderPath = currentPath + folderName + '/';
    
    try {
        const response = await fetch('/api/folder', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({path: folderPath})
        });
        
        const result = await response.json();
        
        if (result.success) {
            closeModal();
            loadFiles();
            showSuccess('Папка создана');
        } else {
            showError(result.message);
        }
    } catch (error) {
        showError('Ошибка создания папки');
    }
}

// Закрытие модального окна
function closeModal() {
    document.getElementById('folderModal').style.display = 'none';
}

// Переключение вкладок
function switchTab(tabName) {
    document.querySelectorAll('.tab-button').forEach(btn => {
        btn.classList.remove('active');
    });
    event.currentTarget.classList.add('active');
    
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    
    document.getElementById(tabName + 'Tab').classList.add('active');
    
    if (tabName === 'logs') {
        refreshLogs();
    }
}

// Обновление логов
async function refreshLogs() {
    try {
        const response = await fetch('/api/logs');
        const result = await response.json();
        
        if (result.success) {
            const logsContainer = document.getElementById('logsContainer');
            logsContainer.innerHTML = result.logs.map(log => 
                `<div class="log-entry">${escapeHtml(log)}</div>`
            ).join('');
        }
    } catch (error) {
        console.error('Ошибка загрузки логов');
    }
}

// Показать сообщение об успехе
function showSuccess(message) {
    console.log('Success:', message);
}

// Показать сообщение об ошибке
function showError(message) {
    console.error('Error:', message);
    alert(message);
}

// Экранирование HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}