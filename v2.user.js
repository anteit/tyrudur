// ==UserScript==
// @name         WPlace Smart Bot Line Renderer V6
// @namespace    http://tampermonkey.net/
// @version      6.2
// @description  Left-to-right line renderer with stable queue, smart stats, mobile touch support, manual coordinates and minimizable logo GUI. Skips pixels already matching canvas. Optimized tile loading.
// @author       ChatGPT & User
// @match        https://wplace.live/*
// @grant        none
// @run-at       document-start
// ==/UserScript==
(function () {
'use strict';

// =========================================================
// STATE
// =========================================================

let pixelQueue = [];
let isPrinting = false;
let botTimeoutId = null;
let totalLoadedPixels = 0;

let globalSavedUrl = null;
let globalSavedOptions = null;

const paintedCache = new Map();

// =========================================================
// TILE CACHE (для проверки цвета на холсте)
// =========================================================

const TILE_SIZE = 1000;
const TILE_CACHE_TTL = 60000; // 60 секунд
const TILE_BASE_URL = 'https://backend.wplace.live/files/s0/tiles';
const tileCache = new Map();

function getTileCoords(x, y) {
    const tx = Math.floor(x / TILE_SIZE);
    const ty = Math.floor(y / TILE_SIZE);
    const px = ((x % TILE_SIZE) + TILE_SIZE) % TILE_SIZE;
    const py = ((y % TILE_SIZE) + TILE_SIZE) % TILE_SIZE;
    return { tx, ty, px, py };
}

async function loadTile(tx, ty) {
    const key = `${tx}_${ty}`;
    const cached = tileCache.get(key);
    const now = Date.now();

    if (cached && (now - cached.loadedAt) < TILE_CACHE_TTL) {        return cached.canvas;
    }

    const url = `${TILE_BASE_URL}/${tx}/${ty}.png?t=${now}`;
    try {
        const response = await originalFetch.call(window, url, {
            credentials: 'omit',
            cache: 'no-store'
        });
        if (!response.ok) {
            if (response.status === 404) {
                const emptyCanvas = document.createElement('canvas');
                emptyCanvas.width = TILE_SIZE;
                emptyCanvas.height = TILE_SIZE;
                tileCache.set(key, { canvas: emptyCanvas, loadedAt: now });
                return emptyCanvas;
            }
            return null;
        }

        const blob = await response.blob();

        // ⚡ ОПТИМИЗАЦИЯ #2: createImageBitmap вместо new Image()
        // Декодирование изображения происходит в отдельном потоке и быстрее
        const bitmap = await createImageBitmap(blob);

        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close(); // Освобождаем память

        tileCache.set(key, { canvas, loadedAt: now });
        return canvas;
    } catch (e) {
        console.warn('[BOT] Failed to load tile', tx, ty, e);
        return null;
    }
}

async function getCanvasColor(x, y) {
    const { tx, ty, px, py } = getTileCoords(x, y);
    const canvas = await loadTile(tx, ty);
    if (!canvas) return null;

    if (px >= canvas.width || py >= canvas.height) return null;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const data = ctx.getImageData(px, py, 1, 1).data;    return { r: data[0], g: data[1], b: data[2], a: data[3] };
}

function clearTileCache() {
    tileCache.clear();
    console.log('[BOT] Tile cache cleared');
}

// ⚡ ОПТИМИЗАЦИЯ #1: Предзагрузка всех нужных тайлов параллельно
async function preloadAllTiles(customX, customY) {
    const baseSubX = parseInt(document.getElementById('bot-coord-x').value) || customX || 0;
    const baseSubY = parseInt(document.getElementById('bot-coord-y').value) || customY || 0;

    // Собираем все уникальные тайлы, которые понадобятся для отрисовки
    const neededTiles = new Set();
    for (const item of pixelQueue) {
        const x = baseSubX + item.offsetX;
        const y = baseSubY + item.offsetY;
        const { tx, ty } = getTileCoords(x, y);
        neededTiles.add(`${tx}_${ty}`);
    }

    if (neededTiles.size === 0) return;

    updateStatus(`Предзагрузка ${neededTiles.size} тайлов...`, '#66ccff');
    console.log(`[BOT] Preloading ${neededTiles.size} tiles`);

    // Параллельная загрузка всех тайлов
    const loadPromises = [];
    for (const key of neededTiles) {
        const [tx, ty] = key.split('_').map(Number);
        loadPromises.push(loadTile(tx, ty));
    }

    await Promise.all(loadPromises);
    console.log(`[BOT] Preload complete`);
}

// =========================================================
// PALETTE
// =========================================================

const PALETTE = [
    [1,0,0,0],[2,60,60,60],[3,120,120,120],[4,210,210,210],[5,255,255,255],
    [6,96,0,24],[7,237,28,36],[8,255,127,39],[9,246,170,9],[10,249,221,59],
    [11,255,250,188],[12,14,185,104],[13,19,230,123],[14,135,255,94],[15,12,129,110],
    [16,16,174,166],[17,19,225,190],[18,40,80,158],[19,64,147,228],[20,96,247,242],
    [21,107,80,246],[22,153,177,251],[23,120,12,153],[24,170,56,185],[25,224,159,249],
    [26,203,0,122],[27,236,31,128],[28,243,141,169],[29,104,70,52],[30,149,104,42],
    [31,248,178,119],[32,170,170,170],[33,165,14,30],[34,250,128,114],[35,228,92,26],    [36,214,181,148],[37,156,132,49],[38,197,173,49],[39,232,212,95],[40,74,107,58],
    [41,90,148,74],[42,132,197,115],[43,15,121,159],[44,187,250,242],[45,125,199,255],
    [46,77,49,184],[47,74,66,132],[48,122,113,196],[49,181,174,241],[50,219,164,99],
    [51,209,128,81],[52,255,197,165],[53,155,82,73],[54,209,128,120],[55,250,182,164],
    [56,123,99,82],[57,156,132,107],[58,51,57,65],[59,109,117,141],[60,179,185,209],
    [61,109,100,63],[62,148,140,107],[63,205,197,158]
];

// =========================================================
// HELPERS
// =========================================================

function getClosestColorId(r, g, b) {

    let minDistance = Infinity;
    let closestId = 1;

    for (let i = 0; i < PALETTE.length; i++) {

        const p = PALETTE[i];

        const dist =
            (r - p[1]) ** 2 +
            (g - p[2]) ** 2 +
            (b - p[3]) ** 2;

        if (dist < minDistance) {

            minDistance = dist;
            closestId = p[0];
        }
    }

    return closestId;
}

function updateQueueUI() {

    const el =
        document.getElementById('bot-queue-count');

    if (el) {
        el.innerText = pixelQueue.length;
    }
}

function updateStatus(text, color = '#fff') {
    const el = document.getElementById('bot-status');
    if (el) {
        el.innerText = text;        el.style.color = color;
    }
}

function setStatsHTML(html) {

    const el =
        document.getElementById('bot-image-stats');

    if (!el) return;

    el.style.display = 'block';
    el.innerHTML = html;
}

// =========================================================
// UI CREATION
// =========================================================

function createUI() {

    if (
        document.getElementById('wplace-bot-panel')
    ) {
        return;
    }

    // Загрузка сохраненных настроек
    const savedX = localStorage.getItem('wplace_bot_x') || '';
    const savedY = localStorage.getItem('wplace_bot_y') || '';
    const savedGuiLeft = localStorage.getItem('wplace_gui_left') || '10px';
    const savedGuiTop = localStorage.getItem('wplace_gui_top') || '20%';
    let isMinimized = localStorage.getItem('wplace_bot_minimized') === 'true';

    const panel =
        document.createElement('div');

    panel.id = 'wplace-bot-panel';

    panel.innerHTML = `
        <div id="bot-expanded-view">
            <div id="bot-drag-handle"
                style="
                    cursor:move;
                    background:#181818;
                    padding:8px;
                    margin:-12px -12px 12px -12px;
                    border-bottom:1px solid #333;
                    border-top-left-radius:10px;
                    border-top-right-radius:10px;                    text-align:center;
                    color:#888;
                    font-size:11px;
                    font-weight:bold;
                    user-select:none;
                    -webkit-user-select:none;
                    position: relative;
                ">
                ::: SMART RENDERER V6 :::
                <span id="bot-minimize-btn" title="Свернуть бота" style="position:absolute; right:10px; top:6px; cursor:pointer; color:#ffaa00; font-size:12px; user-select:none;">🪐</span>
            </div>

            <div style="
                color:#F13E01;
                font-size:14px;
                font-weight:bold;
                margin-bottom:12px;
            ">
                WPlace Smart Bot
            </div>

            <div style="font-size:13px; margin-bottom:6px; user-select:none;">
                Статус:
                <span id="bot-status" style="color:#ffaa00; font-weight:bold;">
                    Ожидание картинки
                </span>
            </div>

            <div style="font-size:13px; margin-bottom:10px; user-select:none;">
                Очередь:
                <span id="bot-queue-count" style="color:#ffaa00; font-weight:bold;">
                    0
                </span>
            </div>

            <div style="margin-bottom: 10px;">
                <div style="font-size:11px; color:#aaa; margin-bottom:4px; user-select:none;">Координаты (X / Y):</div>
                <div style="display: flex; gap: 5px;">
                    <input type="number" id="bot-coord-x" placeholder="X" value="${savedX}" style="width: 50%; background: #141414; color: #fff; border: 1px solid #333; padding: 6px; border-radius: 4px; font-family: monospace; font-size:12px;">
                    <input type="number" id="bot-coord-y" placeholder="Y" value="${savedY}" style="width: 50%; background: #141414; color: #fff; border: 1px solid #333; padding: 6px; border-radius: 4px; font-family: monospace; font-size:12px;">
                </div>
            </div>

            <div id="bot-image-stats"
                style="
                    display:none;
                    background:#141414;
                    border:1px solid #333;
                    border-radius:8px;
                    padding:8px;                    margin-bottom:10px;
                    color:#ccc;
                    font-size:11px;
                    line-height:1.5;
                ">
            </div>

            <label style="
                display:block;
                width:100%;
                padding:10px;
                background:#460942;
                border:1px solid #500A4C;
                border-radius:6px;
                text-align:center;
                color:white;
                cursor:pointer;
                font-weight:bold;
                margin-bottom:8px;
                box-sizing:border-box;
                user-select:none;
                -webkit-user-select:none;
            ">
                🖼️ Load Image
                <input
                    type="file"
                    id="bot-file-input"
                    accept="image/*"
                    style="display:none;"
                >
            </label>

            <button id="btn-start"
                style="
                    width:100%;
                    padding:10px;
                    background:#1b6535;
                    border:1px solid #2f8c4a;
                    border-radius:6px;
                    color:white;
                    cursor:pointer;
                    font-weight:bold;
                    margin-bottom:6px;
                ">
                ▶ Запустить бота
            </button>

            <button id="btn-stop"
                style="
                    width:100%;                    padding:10px;
                    background:#651b1b;
                    border:1px solid #8c2f2f;
                    border-radius:6px;
                    color:white;
                    cursor:pointer;
                    font-weight:bold;
                    margin-bottom:6px;
                ">
                Stop & Clear
            </button>

            <button id="btn-clear-cache"
                style="
                    width:100%;
                    padding:8px;
                    background:#2c2c2c;
                    border:1px solid #444;
                    border-radius:6px;
                    color:#bbb;
                    cursor:pointer;
                    width:100%;
                ">
                Clear Cache
            </button>
        </div>

        <div id="bot-minimized-view"
            style="
                display:none;
                width:55px;
                height:55px;
                cursor:move;
                border-radius:50%;
                background-image:url('https://maikjordan.serv00.net/wplace/logo.png');
                background-size:cover;
                background-position:center;
                border:2px solid #00ffaa;
                box-shadow:0 4px 15px rgba(70,9,66,0.3);
                user-select:none;
                -webkit-user-select:none;
            "
            title="Нажмите, чтобы развернуть бота">
        </div>
    `;

    Object.assign(panel.style, {
        position: 'fixed',
        top: savedGuiTop,
        left: savedGuiLeft,        zIndex: '999999',
        fontFamily: 'monospace',
        transition: 'width 0.15s ease, height 0.15s ease'
    });

    document.body.appendChild(panel);

    // Функция применения стилей в зависимости от сворачивания
    function applyMinimizeState() {
        const expanded = document.getElementById('bot-expanded-view');
        const minimized = document.getElementById('bot-minimized-view');
        if (!expanded || !minimized) return;

        if (isMinimized) {
            expanded.style.display = 'none';
            minimized.style.display = 'block';
            panel.style.width = '55px';
            panel.style.height = '55px';
            panel.style.padding = '0';
            panel.style.background = 'transparent';
            panel.style.border = 'none';
            panel.style.boxShadow = 'none';
        } else {
            expanded.style.display = 'block';
            minimized.style.display = 'none';
            panel.style.width = '255px';
            panel.style.height = 'auto';
            panel.style.padding = '12px';
            panel.style.background = 'rgba(18,18,18,0.97)';
            panel.style.border = '1px solid #333';
            panel.style.boxShadow = '0 10px 40px rgba(0,0,0,0.85)';
        }
    }

    // Первичный вызов состояния
    applyMinimizeState();

    // Обработчик кнопки Свернуть
    document.getElementById('bot-minimize-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        isMinimized = true;
        localStorage.setItem('wplace_bot_minimized', 'true');
        applyMinimizeState();
    });

    // =====================================================
    // DRAG & DROP WITH TOUCH SUPPORT & AUTO-EXPAND CLICK
    // =====================================================
    const handle = document.getElementById('bot-drag-handle');
    const minimizedView = document.getElementById('bot-minimized-view');
    let isDragging = false;
    let hasMoved = false;
    let startX, startY, initialLeft, initialTop;

    function dragStart(e) {
        const clientX = e.type.startsWith('touch') ? e.touches[0].clientX : e.clientX;
        const clientY = e.type.startsWith('touch') ? e.touches[0].clientY : e.clientY;

        isDragging = true;
        hasMoved = false;
        startX = clientX;
        startY = clientY;

        const rect = panel.getBoundingClientRect();
        initialLeft = rect.left;
        initialTop = rect.top;

        if (e.type === 'mousedown') e.preventDefault();
    }

    function dragMove(e) {
        if (!isDragging) return;
        if (e.type === 'touchmove') e.preventDefault();

        const clientX = e.type.startsWith('touch') ? e.touches[0].clientX : e.clientX;
        const clientY = e.type.startsWith('touch') ? e.touches[0].clientY : e.clientY;

        const deltaX = clientX - startX;
        const deltaY = clientY - startY;

        if (Math.abs(deltaX) > 4 || Math.abs(deltaY) > 4) {
            hasMoved = true;
        }

        panel.style.left = `${initialLeft + deltaX}px`;
        panel.style.top = `${initialTop + deltaY}px`;
    }

    function dragEnd() {
        if (isDragging) {
            isDragging = false;
            localStorage.setItem('wplace_gui_left', panel.style.left);
            localStorage.setItem('wplace_gui_top', panel.style.top);

            if (isMinimized && !hasMoved) {
                isMinimized = false;
                localStorage.setItem('wplace_bot_minimized', 'false');
                applyMinimizeState();
            }        }
    }

    handle.addEventListener('mousedown', dragStart);
    minimizedView.addEventListener('mousedown', dragStart);
    window.addEventListener('mousemove', dragMove);
    window.addEventListener('mouseup', dragEnd);

    handle.addEventListener('touchstart', dragStart, { passive: true });
    minimizedView.addEventListener('touchstart', dragStart, { passive: true });
    window.addEventListener('touchmove', dragMove, { passive: false });
    window.addEventListener('touchend', dragEnd);

    document.getElementById('bot-coord-x').addEventListener('input', (e) => {
        localStorage.setItem('wplace_bot_x', e.target.value);
    });
    document.getElementById('bot-coord-y').addEventListener('input', (e) => {
        localStorage.setItem('wplace_bot_y', e.target.value);
    });

    // =====================================================
    // IMAGE LOADER
    // =====================================================

    document
        .getElementById('bot-file-input')
        .addEventListener('change', function (e) {

            const file = e.target.files[0];

            if (!file) return;

            if (botTimeoutId) {
                clearTimeout(botTimeoutId);
            }

            isPrinting = false;
            updateStatus('Обработка картинки...', '#ffaa00');

            const img = new Image();

            img.onload = function () {

                const canvas =
                    document.createElement('canvas');

                canvas.width = img.width;
                canvas.height = img.height;

                const ctx =                    canvas.getContext('2d', {
                        willReadFrequently: true
                    });

                ctx.drawImage(img, 0, 0);

                const imageData =
                    ctx.getImageData(
                        0,
                        0,
                        img.width,
                        img.height
                    );

                const data = imageData.data;

                pixelQueue = [];

                const colorStats = new Map();

                let totalPixels = 0;

                for (let y = 0; y < img.height; y++) {

                    for (let x = 0; x < img.width; x++) {

                        const idx =
                            (y * img.width + x) * 4;

                        const alpha =
                            data[idx + 3];

                        if (alpha < 128) {
                            continue;
                        }

                        const colorId =
                            getClosestColorId(
                                data[idx],
                                data[idx + 1],
                                data[idx + 2]
                            );

                        pixelQueue.push({
                            offsetX: x,
                            offsetY: y,
                            color: colorId
                        });

                        totalPixels++;
                        if (!colorStats.has(colorId)) {

                            colorStats.set(colorId, {
                                count: 1,
                                firstX: x,
                                firstY: y
                            });

                        } else {

                            colorStats
                                .get(colorId)
                                .count++;
                        }
                    }
                }

                let repeatedPixels = 0;

                let dominantColor = 0;
                let dominantCount = 0;

                let dominantFirstX = 0;
                let dominantFirstY = 0;

                for (
                    const [colorId, stat]
                    of colorStats.entries()
                ) {

                    if (stat.count > 1) {

                        repeatedPixels +=
                            (stat.count - 1);
                    }

                    if (stat.count > dominantCount) {

                        dominantCount =
                            stat.count;

                        dominantColor =
                            colorId;

                        dominantFirstX =
                            stat.firstX;

                        dominantFirstY =
                            stat.firstY;                    }
                }

                const repeatPercent =
                    totalPixels > 0 ? Math.round((repeatedPixels / totalPixels) * 100) : 0;

                totalLoadedPixels = totalPixels;
                updateQueueUI();
                updateStatus('Готов к запуску', '#00ffaa');

                const btnStart = document.getElementById('btn-start');
                if (btnStart) {
                    btnStart.innerText = '▶ Запустить бота';
                    btnStart.style.background = '#1b6535';
                }

                setStatsHTML(`
                    <div style="
                        color:#00ffaa;
                        font-weight:bold;
                        margin-bottom:5px;
                    ">
                        📊 IMAGE ANALYSIS
                    </div>

                    <div>
                        Total Pixels:
                        <span style="color:#fff">
                            ${totalPixels}
                        </span>
                    </div>

                    <div>
                        Repeated:
                        <span style="color:#ffaa00">
                            ${repeatedPixels}/${totalPixels}
                        </span>
                        (${repeatPercent}%)
                    </div>

                    <div>
                        Main Color:
                        <span style="color:#66ccff">
                            ID ${dominantColor}
                        </span>
                    </div>

                    <div>
                        First Pixel:
                        <span style="color:#ff8888">                            X:${dominantFirstX}
                            Y:${dominantFirstY}
                        </span>
                    </div>
                `);

                console.log(
                    `[BOT] Loaded ${pixelQueue.length} pixels`
                );

                e.target.value = '';
            };

            img.src =
                URL.createObjectURL(file);
        });

    // =====================================================
    // START / PAUSE
    // =====================================================
    document.getElementById('btn-start').addEventListener('click', () => {
        if (pixelQueue.length === 0) {
            alert('Сначала загрузите изображение!');
            return;
        }

        const x = parseInt(document.getElementById('bot-coord-x').value);
        const y = parseInt(document.getElementById('bot-coord-y').value);

        if (isNaN(x) || isNaN(y)) {
            alert('Введите корректные координаты X и Y или поставьте пиксель на холсте для автоопределения!');
            return;
        }

        const btnStart = document.getElementById('btn-start');

        if (isPrinting) {
            isPrinting = false;
            if (botTimeoutId) clearTimeout(botTimeoutId);
            updateStatus('Пауза', '#ffaa00');
            btnStart.innerText = '▶ Запустить бота';
            btnStart.style.background = '#1b6535';
        } else {
            btnStart.innerText = '⏸ Пауза';
            btnStart.style.background = '#d97706';
            startPrintingLoop(x, y);
        }
    });

    // =====================================================    // STOP
    // =====================================================

    document
        .getElementById('btn-stop')
        .addEventListener('click', () => {

            pixelQueue = [];
            isPrinting = false;
            totalLoadedPixels = 0;

            if (botTimeoutId) {
                clearTimeout(botTimeoutId);
            }

            updateQueueUI();
            updateStatus('Остановлен / Очищен', '#ff5555');

            const btnStart = document.getElementById('btn-start');
            if (btnStart) {
                btnStart.innerText = '▶ Запустить бота';
                btnStart.style.background = '#1b6535';
            }

            console.log('[BOT] Stopped');
        });

    // =====================================================
    // CLEAR CACHE
    // =====================================================

    document
        .getElementById('btn-clear-cache')
        .addEventListener('click', () => {

            paintedCache.clear();
            clearTileCache();

            console.log('[BOT] Cache cleared');
        });
}

// =========================================================
// INIT
// =========================================================

if (document.readyState === 'loading') {

    window.addEventListener(
        'DOMContentLoaded',        createUI
    );

} else {

    createUI();
}

setTimeout(createUI, 1500);

// =========================================================
// FETCH INTERCEPT
// =========================================================

const originalFetch = window.fetch;

// =========================================================
// DRAW LOOP
// =========================================================

async function startPrintingLoop(customX, customY) {

    if (isPrinting && botTimeoutId) return;

    isPrinting = true;

    if (!globalSavedUrl || !globalSavedOptions) {
        updateStatus('Ожидание клика для авторизации...', '#ffaa00');
        console.log('[BOT] Поставьте 1 любой пиксель на холсте, чтобы бот перехватил сессию авторизации.');
        isPrinting = false;
        const btnStart = document.getElementById('btn-start');
        if (btnStart) {
            btnStart.innerText = '▶ Запустить бота';
            btnStart.style.background = '#1b6535';
        }
        return;
    }

    console.log('[BOT] Start line rendering');

    // ⚡ ОПТИМИЗАЦИЯ #1: Предзагрузка всех тайлов перед стартом
    try {
        await preloadAllTiles(customX, customY);
    } catch (preloadErr) {
        console.warn('[BOT] Preload failed, continuing with on-demand loading', preloadErr);
    }

    // Проверка — не остановили ли бота во время предзагрузки
    if (!isPrinting) return;
    updateStatus('Тайлы готовы, начинаю отрисовку', '#00ffaa');

    async function drawNext() {

        if (!isPrinting) return;

        if (pixelQueue.length === 0) {

            console.log('[BOT] Finished');
            isPrinting = false;
            updateStatus('Готово!', '#00ffaa');

            const btnStart = document.getElementById('btn-start');
            if (btnStart) {
                btnStart.innerText = '▶ Запустить бота';
                btnStart.style.background = '#1b6535';
            }
            return;
        }

        const baseSubX = parseInt(document.getElementById('bot-coord-x').value) || customX || 0;
        const baseSubY = parseInt(document.getElementById('bot-coord-y').value) || customY || 0;

        const item = pixelQueue[0];

        const targetX =
            baseSubX + item.offsetX;

        const targetY =
            baseSubY + item.offsetY;

        const targetColor =
            item.color;

        const cacheKey =
            `${targetX}_${targetY}`;

        const currentDone = totalLoadedPixels - pixelQueue.length;

        // ⚡ ОПТИМИЗАЦИЯ #4: Пропуск уже нарисованных нами пикселей БЕЗ проверки тайла
        // Если мы уже рисовали этот пиксель с этим цветом — пропускаем сразу
        if (paintedCache.get(cacheKey) === targetColor) {
            pixelQueue.shift();
            updateQueueUI();
            botTimeoutId = setTimeout(drawNext, 10);
            return;
        }

        updateStatus(`Проверка: ${currentDone}/${totalLoadedPixels} (${targetX}, ${targetY})`, '#66ccff');
        // =====================================================
        // CANVAS COLOR CHECK (пропуск уже окрашенных пикселей)
        // =====================================================
        try {
            const canvasColor = await getCanvasColor(targetX, targetY);
            if (canvasColor && canvasColor.a === 255) {
                const canvasColorId = getClosestColorId(canvasColor.r, canvasColor.g, canvasColor.b);
                if (canvasColorId === targetColor) {
                    // Пиксель уже имеет нужный цвет — пропускаем без запроса
                    paintedCache.set(cacheKey, targetColor);
                    pixelQueue.shift();
                    updateQueueUI();
                    console.log(`[BOT] SKIP (already painted) ${targetX}:${targetY} color=${targetColor}`);
                    botTimeoutId = setTimeout(drawNext, 10);
                    return;
                }
            }
        } catch (checkErr) {
            console.warn('[BOT] Canvas check failed, proceeding with paint', checkErr);
        }

        updateStatus(`Печать: ${currentDone}/${totalLoadedPixels} (${targetX}, ${targetY})`, '#00ffaa');

        try {

            const currentOptions = {
                method: globalSavedOptions.method,
                headers: globalSavedOptions.headers,
                credentials: globalSavedOptions.credentials,
                mode: globalSavedOptions.mode,
                referrer: globalSavedOptions.referrer
            };

            const bodyObj =
                JSON.parse(
                    globalSavedOptions.originalBody
                );

            const tile =
                bodyObj.tiles[0];

            tile.pixels.x = [targetX];
            tile.pixels.y = [targetY];
            tile.pixels.colors = [targetColor];

            currentOptions.body =
                JSON.stringify(bodyObj);

            const response =
                await originalFetch(                    globalSavedUrl,
                    currentOptions
                );

            const responseText =
                await response.text();

            const lower =
                responseText.toLowerCase();

            const accepted =
                response.ok &&
                !lower.includes('cooldown') &&
                !lower.includes('wait') &&
                !lower.includes('limit') &&
                !lower.includes('error');

            const already =
                lower.includes('already') ||
                lower.includes('same');

            if (accepted || already) {

                paintedCache.set(
                    cacheKey,
                    targetColor
                );

                // ⚡ ОПТИМИЗАЦИЯ #3: Локальное обновление кеша тайла вместо удаления
                // Обновляем пиксель прямо в canvas в памяти, чтобы следующий пиксель
                // видел актуальное состояние без повторной загрузки с сервера
                const { tx, ty, px, py } = getTileCoords(targetX, targetY);
                const tileKey = `${tx}_${ty}`;
                const cached = tileCache.get(tileKey);

                if (cached && cached.canvas) {
                    const paletteColor = PALETTE.find(p => p[0] === targetColor);
                    if (paletteColor) {
                        const ctx = cached.canvas.getContext('2d');
                        // Прозрачные пиксели (colorId=0) очищаем, цветные — зарисовываем
                        if (targetColor === 0) {
                            ctx.clearRect(px, py, 1, 1);
                        } else {
                            ctx.fillStyle = `rgb(${paletteColor[1]},${paletteColor[2]},${paletteColor[3]})`;
                            ctx.fillRect(px, py, 1, 1);
                        }
                    }
                    // Обновляем timestamp, чтобы тайл не протух во время длинной отрисовки
                    cached.loadedAt = Date.now();
                }
                pixelQueue.shift();
                updateQueueUI();

                console.log(
                    `[BOT] OK ${targetX}:${targetY}`
                );

                const delay =
                    1600 +
                    Math.floor(
                        Math.random() * 700
                    );

                botTimeoutId =
                    setTimeout(drawNext, delay);

            } else {

                console.warn(
                    '[BOT] Retry',
                    response.status,
                    responseText
                );

                updateStatus('Кулдаун / Ожидание...', '#ffaa00');

                let cooldownDelay = 3000;
                const matchTime = responseText.match(/(\d+)/);
                if (matchTime) {
                    const parsedSec = parseInt(matchTime[1]);
                    if (parsedSec > 0 && parsedSec < 60) {
                        cooldownDelay = parsedSec * 1000 + 500;
                    }
                }

                botTimeoutId =
                    setTimeout(drawNext, cooldownDelay);
            }

        } catch (err) {

            console.error(
                '[BOT] Network Error',
                err
            );

            updateStatus('Ошибка сети, повтор...', '#ff5555');
            botTimeoutId =
                setTimeout(drawNext, 3500);        }
    }

    botTimeoutId =
        setTimeout(drawNext, 500);
}

// =========================================================
// INTERCEPT INTERFACE
// =========================================================

window.fetch = async function (...args) {

    try {

        const url =
            typeof args[0] === 'string'
                ? args[0]
                : args[0]?.url;

        const options = args[1];

        if (
            url &&
            url.includes('/paint') &&
            options &&
            options.body
        ) {

            globalSavedUrl = url;
            globalSavedOptions = {
                method: options.method,
                headers: options.headers,
                credentials: options.credentials,
                mode: options.mode,
                referrer: options.referrer,
                originalBody: options.body
            };

            const bodyObj = JSON.parse(options.body);
            const tile = bodyObj.tiles[0];

            if (tile && tile.pixels && tile.pixels.x) {
                const baseSubX = tile.pixels.x[0];
                const baseSubY = tile.pixels.y[0];

                const inputX = document.getElementById('bot-coord-x');
                const inputY = document.getElementById('bot-coord-y');

                if (inputX) {                    inputX.value = baseSubX;
                    localStorage.setItem('wplace_bot_x', baseSubX);
                }
                if (inputY) {
                    inputY.value = baseSubY;
                    localStorage.setItem('wplace_bot_y', baseSubY);
                }

                if (pixelQueue.length > 0 && !isPrinting) {
                    const btnStart = document.getElementById('btn-start');
                    if (btnStart) {
                        btnStart.innerText = '⏸ Пауза';
                        btnStart.style.background = '#d97706';
                    }
                    startPrintingLoop(baseSubX, baseSubY);
                    console.log('[BOT] Activated from Interceptor');
                }
            }
        }

    } catch (err) {

        console.error(
            '[BOT] Intercept Error',
            err
        );
    }

    return originalFetch.apply(this, args);
};
})();
