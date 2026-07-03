/**
 * 百度网盘文件夹搜索器 - content.js
 * 版本: v1.0.2 - 适配新版百度网盘
 */

(function() {
  'use strict';

  // ============================================
  // 配置
  // ============================================
  const CONFIG = {
    debounceDelay: 300,
    searchWaitTime: 1000,
    navigateDelay: 500,
    maxResults: 30,
    debug: false,
  };

  // ============================================
  // 状态
  // ============================================
  let isPanelVisible = false;
  let currentResults = [];
  let activeIndex = -1;
  let searchAbortController = null;

  // ============================================
  // 调试日志
  // ============================================
  function log(...args) {
    if (CONFIG.debug) {
      console.log('[搜索器]', ...args);
    }
  }

  // ============================================
  // 工具函数
  // ============================================
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

  function isVisible(element) {
    if (!element) return false;
    const style = window.getComputedStyle(element);
    return style.display !== 'none' &&
           style.visibility !== 'hidden' &&
           element.offsetParent !== null;
  }

  // ============================================
  // DOM 元素创建
  // ============================================
  function createToggleButton() {
    const btn = document.createElement('button');
    btn.id = 'folder-search-toggle';
    btn.innerHTML = '🔍';
    btn.title = '文件夹搜索 (Ctrl+K)';
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

    if (searchAbortController) {
      searchAbortController.abort();
      searchAbortController = null;
    }
  }

  // ============================================
  // 核心搜索功能
  // ============================================

  /**
   * 执行搜索
   */
  async function performSearch(keyword) {
    if (!keyword || keyword.trim() === '') {
      clearSearch();
      return;
    }

    if (searchAbortController) {
      searchAbortController.abort();
    }
    searchAbortController = new AbortController();

    const resultsContainer = document.querySelector('.search-results');
    const clearBtn = document.querySelector('.search-clear');
    if (clearBtn) clearBtn.classList.add('visible');

    // 显示加载状态
    resultsContainer.innerHTML = `
      <div class="search-loading">
        <div class="spinner"></div>
        <p>搜索中...</p>
      </div>
    `;

    try {
      const folders = searchFolders(keyword);
      displayResults(folders, keyword);
    } catch (error) {
      if (error.name !== 'AbortError') {
        log('搜索出错:', error);
        displayResults([], keyword);
      }
    }
  }

  /**
   * 搜索文件夹
   */
  function searchFolders(keyword) {
    const folders = [];
    const keywordLower = keyword.toLowerCase();

    log('开始搜索，关键词:', keyword);

    // 获取面包屑路径
    let currentPath = '';
    const breadcrumbEl = document.querySelector('[jsaction="breadcrumb"]');
    if (breadcrumbEl) {
      const links = breadcrumbEl.querySelectorAll('a, span');
      const pathParts = [];
      links.forEach(el => {
        const text = el.textContent.trim();
        if (text && text !== '>' && text !== '›') {
          pathParts.push(text);
        }
      });
      currentPath = pathParts.join(' > ');
      log('当前路径:', currentPath);
    }

    // 查找所有文件列表项 - 新版百度网盘
    const selectors = [
      // 主要选择器 - jsaction="click:item"
      '[jsaction="click:item"]',
      // 备用选择器
      '.oJxPteb5e19b',
      '.j9pXPteb5e19b',
      // 通用文件项
      '[data-type="1"]',
      // 网格视图项
      '.g-image-item',
      // 列表视图项
      '.list-item',
    ];

    let fileItems = [];

    for (const selector of selectors) {
      const elements = document.querySelectorAll(selector);
      log(`选择器 "${selector}": 找到 ${elements.length} 个`);
      if (elements.length > 0) {
        fileItems = elements;
        break;
      }
    }

    // 遍历文件项，提取文件夹
    fileItems.forEach(item => {
      // 获取文件名 - 查找 .title 元素
      let name = '';

      // 方法1: .title 元素
      const titleEl = item.querySelector('.title');
      if (titleEl) {
        name = titleEl.getAttribute('title') || titleEl.textContent;
      }

      // 方法2: 直接从 item 获取 title
      if (!name) {
        name = item.getAttribute('title') || '';
      }

      // 方法3: 查找任意有 title 的子元素
      if (!name) {
        const titledEl = item.querySelector('[title]');
        if (titledEl) {
          name = titledEl.getAttribute('title');
        }
      }

      name = name.trim();

      // 判断是否是文件夹
      // 方法1: 检查是否有 📁 图标
      const hasFolderIcon = item.querySelector('.u-font-icon')?.textContent?.includes('📁');

      // 方法2: 检查 class 或 data 属性
      const isFolderItem = item.classList.contains('oJxPteb5e19b') ||
                          item.classList.contains('j9pXPteb5e19b') ||
                          item.getAttribute('data-type') === '1' ||
                          item.getAttribute('data-isDir') === '1';

      // 如果匹配到关键词且是文件夹
      if (name && name.toLowerCase().includes(keywordLower)) {
        if (hasFolderIcon || isFolderItem) {
          log(`找到文件夹: ${name}`);
          folders.push({
            name: name,
            path: currentPath || '根目录',
            element: item,
          });
        }
      }
    });

    log('找到文件夹数量:', folders.length);
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
          <p class="hint">请确认在文件列表页面</p>
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

    // 绑定事件
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
        // 直接点击文件夹项
        folder.element.click();
        await delay(CONFIG.navigateDelay);
        showToast(`已进入: ${folder.name}`, 'success');
      } else {
        showToast('未找到文件夹，请手动操作', 'error');
      }
    } catch (error) {
      log('导航错误:', error);
      showToast('导航失败', 'error');
    }
  }

  // ============================================
  // 键盘事件
  // ============================================
  function handleKeydown(e) {
    // Ctrl/Cmd + K
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
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
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initUI);
    } else {
      setTimeout(initUI, 1500);
    }
  }

  function initUI() {
    createToggleButton();
    createSearchPanel();

    const panel = document.getElementById('folder-search-panel');
    const input = panel.querySelector('.search-input');
    const clearBtn = panel.querySelector('.search-clear');

    // 搜索输入
    const debouncedSearch = debounce((keyword) => {
      performSearch(keyword);
    }, CONFIG.debounceDelay);

    input.addEventListener('input', (e) => {
      debouncedSearch(e.target.value.trim());
    });

    // 清除按钮
    clearBtn.addEventListener('click', () => {
      input.value = '';
      clearBtn.classList.remove('visible');
      clearSearch();
      input.focus();
    });

    // 全局键盘
    document.addEventListener('keydown', handleKeydown);

    // 点击外部关闭
    document.addEventListener('click', (e) => {
      const panel = document.getElementById('folder-search-panel');
      const toggle = document.getElementById('folder-search-toggle');

      if (isPanelVisible && panel && !panel.contains(e.target) && !toggle.contains(e.target)) {
        closePanel();
      }
    });

    console.log('%c✅ 百度网盘文件夹搜索器已加载 (v1.0.2)', 'color: green; font-weight: bold');
    console.log('%c💡 按 Ctrl+K 打开搜索面板', 'color: blue');
  }

  // 调试函数
  window.baiduSearchDebug = function() {
    console.log('=== 调试信息 ===');

    // 面包屑
    const breadcrumb = document.querySelector('[jsaction="breadcrumb"]');
    console.log('面包屑:', breadcrumb?.textContent?.trim());

    // 文件项
    const testSelectors = [
      '[jsaction="click:item"]',
      '.oJxPteb5e19b',
      '.j9pXPteb5e19b',
      '.title',
      '.u-font-icon',
    ];

    testSelectors.forEach(sel => {
      const els = document.querySelectorAll(sel);
      console.log(`"${sel}": ${els.length} 个`);
      if (els.length > 0 && els.length < 10) {
        els.forEach(el => {
          const title = el.getAttribute('title') || el.textContent?.substring(0, 30);
          console.log(`  - ${title}`);
        });
      }
    });
  };

  init();

})();
