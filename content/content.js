/**
 * 百度网盘文件夹搜索器 - content.js
 * 版本: v1.0.5 - 修复文件夹识别
 */

(function() {
  'use strict';

  const CONFIG = {
    debounceDelay: 200,
    navigateDelay: 500,
    maxResults: 30,
    debug: false,
  };

  let isPanelVisible = false;
  let currentResults = [];
  let activeIndex = -1;

  const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  function debounce(fn, delay) {
    let timer = null;
    return function(...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function highlightKeyword(text, keyword) {
    if (!keyword) return text;
    const regex = new RegExp(`(${escapeRegExp(keyword)})`, 'gi');
    return text.replace(regex, '<mark>$1</mark>');
  }

  function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function showToast(message, type = 'info') {
    const existingToast = document.querySelector('.search-toast');
    if (existingToast) existingToast.remove();

    const toast = document.createElement('div');
    toast.className = `search-toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => toast.remove(), 3000);
  }

  function log(...args) {
    if (CONFIG.debug) {
      console.log('[搜索器]', ...args);
    }
  }

  // ============================================
  // DOM 元素创建
  // ============================================
  function createToggleButton() {
    const btn = document.createElement('button');
    btn.id = 'folder-search-toggle';
    btn.innerHTML = '🔍';
    btn.title = '文件夹搜索';
    btn.addEventListener('click', togglePanel);
    document.body.appendChild(btn);
    return btn;
  }

  function createSearchPanel() {
    const panel = document.createElement('div');
    panel.id = 'folder-search-panel';
    panel.innerHTML = `
      <div class="search-header">
        <span class="search-icon">🔍</span>
        <div class="search-input-wrapper">
          <input type="text"
                 class="search-input"
                 placeholder="输入文件夹名称..."
                 autocomplete="off"
                 spellcheck="false">
          <button class="search-clear" title="清除">✕</button>
        </div>
      </div>
      <div class="search-results">
        <div class="search-empty">
          <div class="empty-icon">📁</div>
          <p>输入关键词搜索文件夹</p>
          <p class="hint">点击结果直接跳转</p>
        </div>
      </div>
      <div class="search-footer">
        <div class="shortcut">
          <span class="key">↑↓</span> 选择
          <span class="key">Enter</span> 进入
          <span class="key">Esc</span> 关闭
        </div>
      </div>
    `;
    document.body.appendChild(panel);
    return panel;
  }

  // ============================================
  // 面板控制
  // ============================================
  function togglePanel() {
    const panel = document.getElementById('folder-search-panel');
    if (!panel) return;

    isPanelVisible = !isPanelVisible;

    if (isPanelVisible) {
      panel.classList.add('visible');
      const input = panel.querySelector('.search-input');
      if (input) input.focus();
    } else {
      panel.classList.remove('visible');
      clearSearch();
    }
  }

  function closePanel() {
    const panel = document.getElementById('folder-search-panel');
    if (panel) {
      panel.classList.remove('visible');
      isPanelVisible = false;
    }
    clearSearch();
  }

  function clearSearch() {
    const input = document.querySelector('.search-input');
    const clearBtn = document.querySelector('.search-clear');
    const results = document.querySelector('.search-results');

    if (input) input.value = '';
    if (clearBtn) clearBtn.classList.remove('visible');
    if (results) {
      results.innerHTML = `
        <div class="search-empty">
          <div class="empty-icon">📁</div>
          <p>输入关键词搜索文件夹</p>
          <p class="hint">点击结果直接跳转</p>
        </div>
      `;
    }

    currentResults = [];
    activeIndex = -1;
  }

  // ============================================
  // 核心搜索功能 - 根据实际 DOM 结构
  // ============================================
  function performSearch(keyword) {
    if (!keyword || keyword.trim() === '') {
      clearSearch();
      return;
    }

    const resultsContainer = document.querySelector('.search-results');
    const clearBtn = document.querySelector('.search-clear');
    if (clearBtn) clearBtn.classList.add('visible');

    resultsContainer.innerHTML = `
      <div class="search-loading">
        <div class="spinner"></div>
        <p>搜索中...</p>
      </div>
    `;

    const folders = searchFolders(keyword);
    displayResults(folders, keyword);
  }

  function searchFolders(keyword) {
    const folders = [];
    const keywordLower = keyword.toLowerCase();

    // 获取面包屑路径
    let currentPath = '当前位置';
    const breadcrumbEl = document.querySelector('[jsaction="breadcrumb"]');
    if (breadcrumbEl) {
      const spans = breadcrumbEl.querySelectorAll('span');
      const pathParts = [];
      spans.forEach(span => {
        const text = span.textContent.trim();
        if (text && text !== '>' && text !== '›') {
          pathParts.push(text);
        }
      });
      if (pathParts.length > 0) {
        currentPath = pathParts.join(' > ');
      }
    }

    // 找到所有文件项 - 关键选择器！
    // 从截图看，文件项有 jsaction="click:item" 属性
    const fileItems = document.querySelectorAll('[jsaction="click:item"]');

    log('找到文件项数量:', fileItems.length);

    fileItems.forEach((item, index) => {
      // 获取图标 - 判断是文件夹还是文件
      const iconEl = item.querySelector('.u-font-icon');
      if (!iconEl) return;

      const iconText = iconEl.textContent || '';
      const isFolder = iconText.includes('📁');

      // 只处理文件夹
      if (!isFolder) return;

      // 获取文件名 - 从 .title 元素获取
      const titleEl = item.querySelector('.title');
      if (!titleEl) return;

      // 优先使用 title 属性
      let name = titleEl.getAttribute('title') || titleEl.textContent;
      name = name.trim();

      if (!name) return;

      // 匹配关键词
      if (name.toLowerCase().includes(keywordLower)) {
        folders.push({
          name: name,
          path: currentPath,
          element: item,
        });
      }
    });

    log('找到匹配文件夹:', folders.length);
    return folders.slice(0, CONFIG.maxResults);
  }

  /**
   * 显示搜索结果
   */
  function displayResults(folders, keyword) {
    const resultsContainer = document.querySelector('.search-results');
    if (!resultsContainer) return;

    currentResults = folders;
    activeIndex = folders.length > 0 ? 0 : -1;

    if (folders.length === 0) {
      resultsContainer.innerHTML = `
        <div class="search-empty">
          <div class="empty-icon">🔍</div>
          <p>未找到匹配的文件夹</p>
          <p class="hint">试试其他关键词</p>
        </div>
      `;
      return;
    }

    let html = '';
    folders.forEach((folder, index) => {
      const highlightedName = highlightKeyword(folder.name, keyword);

      html += `
        <div class="result-item ${index === 0 ? 'active' : ''}"
             data-index="${index}">
          <span class="result-icon">📁</span>
          <div class="result-content">
            <div class="result-name">${highlightedName}</div>
            <div class="result-path">${escapeHtml(folder.path)}</div>
          </div>
          <span class="result-hint">↵</span>
        </div>
      `;
    });

    resultsContainer.innerHTML = html;

    resultsContainer.querySelectorAll('.result-item').forEach(item => {
      item.addEventListener('click', () => {
        const index = parseInt(item.dataset.index, 10);
        navigateToFolder(folders[index]);
      });

      item.addEventListener('mouseenter', () => {
        updateActiveIndex(index);
      });
    });
  }

  function updateActiveIndex(newIndex) {
    activeIndex = newIndex;
    document.querySelectorAll('.result-item').forEach((item, index) => {
      item.classList.toggle('active', index === activeIndex);
    });
  }

  // ============================================
  // 导航功能
  // ============================================
  async function navigateToFolder(folder) {
    closePanel();
    showToast(`正在进入: ${folder.name}`);

    try {
      if (folder.element) {
        folder.element.click();
        await delay(CONFIG.navigateDelay);
        showToast(`已进入: ${folder.name}`, 'success');
      } else {
        showToast('未找到文件夹', 'error');
      }
    } catch (error) {
      console.error('导航错误:', error);
      showToast('导航失败', 'error');
    }
  }

  // ============================================
  // 键盘事件
  // ============================================
  function handleKeydown(e) {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      e.stopPropagation();
      togglePanel();
      return;
    }

    if (!isPanelVisible) return;

    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        closePanel();
        break;

      case 'ArrowDown':
        e.preventDefault();
        if (currentResults.length > 0) {
          updateActiveIndex(Math.min(activeIndex + 1, currentResults.length - 1));
          scrollActiveIntoView();
        }
        break;

      case 'ArrowUp':
        e.preventDefault();
        if (currentResults.length > 0) {
          updateActiveIndex(Math.max(activeIndex - 1, 0));
          scrollActiveIntoView();
        }
        break;

      case 'Enter':
        e.preventDefault();
        if (activeIndex >= 0 && currentResults[activeIndex]) {
          navigateToFolder(currentResults[activeIndex]);
        }
        break;
    }
  }

  function scrollActiveIntoView() {
    const activeItem = document.querySelector('.result-item.active');
    if (activeItem) {
      activeItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  // ============================================
  // 初始化
  // ============================================
  function init() {
    log('开始初始化');

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initUI);
    } else {
      setTimeout(initUI, 2000);
    }
  }

  function initUI() {
    createToggleButton();
    createSearchPanel();

    const panel = document.getElementById('folder-search-panel');
    const input = panel.querySelector('.search-input');
    const clearBtn = panel.querySelector('.search-clear');

    input.addEventListener('input', (e) => {
      performSearch(e.target.value.trim());
    });

    clearBtn.addEventListener('click', () => {
      input.value = '';
      clearBtn.classList.remove('visible');
      clearSearch();
      input.focus();
    });

    document.addEventListener('keydown', handleKeydown, true);

    document.addEventListener('click', (e) => {
      const panel = document.getElementById('folder-search-panel');
      const toggle = document.getElementById('folder-search-toggle');

      if (isPanelVisible && panel && !panel.contains(e.target) && !toggle.contains(e.target)) {
        closePanel();
      }
    });

    console.log('%c✅ 百度网盘文件夹搜索器已加载 (v1.0.5)', 'color: green; font-weight: bold');
    console.log('%c💡 按 Ctrl+K 或点击右下角 🔍 打开搜索面板', 'color: blue');
  }

  // 调试函数
  window.baiduSearchDebug = function() {
    console.log('=== 调试信息 ===');
    const items = document.querySelectorAll('[jsaction="click:item"]');
    console.log('[jsaction="click:item"] 数量:', items.length);

    items.forEach((item, i) => {
      const icon = item.querySelector('.u-font-icon')?.textContent || '';
      const title = item.querySelector('.title')?.getAttribute('title') || '';
      console.log(`[${i}] 图标: "${icon}", 名称: "${title}"`);
    });
  };

  init();

})();
