/**
 * 百度网盘文件夹搜索器 - content.js
 * 版本: v1.0.1 - 修复搜索问题
 */

(function() {
  'use strict';

  // ============================================
  // 配置
  // ============================================
  const CONFIG = {
    debounceDelay: 400,
    searchWaitTime: 1200,
    navigateDelay: 500,
    maxResults: 30,
    debug: false,  // 调试模式
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
      console.log('[文件夹搜索器]', ...args);
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
  // 搜索功能 - 核心
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
      // 方案: 直接遍历当前可见的文件夹（最可靠）
      const folders = searchVisibleFolders(keyword);

      if (folders.length > 0) {
        displayResults(folders, keyword);
      } else {
        // 如果没找到，尝试模拟网盘搜索
        const searchResults = await tryPageSearch(keyword, searchAbortController.signal);
        if (searchResults.length > 0) {
          displayResults(searchResults, keyword);
        } else {
          displayResults([], keyword);
        }
      }
    } catch (error) {
      if (error.name !== 'AbortError') {
        log('搜索出错:', error);
        displayResults([], keyword);
      }
    }
  }

  /**
   * 搜索当前可见的文件夹
   */
  function searchVisibleFolders(keyword) {
    const folders = [];
    const keywordLower = keyword.toLowerCase();

    log('开始搜索可见文件夹，关键词:', keyword);

    // 百度网盘可能的文件夹选择器
    const selectors = [
      // 表格视图
      '.file-list div[data-type="1"]',
      '.file-list .folder',
      '.list-view .folder-item',
      // 网格视图
      '.grid-view .folder-item',
      // 通用
      '[data-type="1"]',
      '.item-wrapper[data-type]',
      // 百度网盘特定
      '.wp-s-file-list__list .item-wrapper',
      '.nd-file-list-tree-node',
      // 备用
      '.tree-view .folder',
      '.explorer-nested .folder',
      '.file-entity',
    ];

    let foundElements = [];

    for (const selector of selectors) {
      const elements = document.querySelectorAll(selector);
      log(`尝试选择器 "${selector}": 找到 ${elements.length} 个`);

      if (elements.length > 0) {
        foundElements = elements;
        break;
      }
    }

    foundElements.forEach(element => {
      // 尝试多种方式获取文件夹名称
      let name = '';

      // 方法1: title 属性
      name = element.getAttribute('title') || '';

      // 方法2: data-name 属性
      if (!name) {
        name = element.getAttribute('data-name') || '';
      }

      // 方法3: data-title 属性
      if (!name) {
        name = element.getAttribute('data-title') || '';
      }

      // 方法4: 子元素中的文本
      if (!name) {
        const nameEl = element.querySelector('[title]') ||
                       element.querySelector('.name') ||
                       element.querySelector('.filename') ||
                       element.querySelector('.text');
        name = nameEl ? (nameEl.getAttribute('title') || nameEl.textContent) : '';
      }

      // 方法5: 直接取文本内容
      if (!name) {
        name = element.textContent || '';
      }

      name = name.trim();

      // 匹配关键词
      if (name && name.toLowerCase().includes(keywordLower)) {
        // 获取路径
        let path = '';

        // 尝试从面包屑获取路径
        const breadcrumb = document.querySelector('.bread-crumb, .breadcrumb, [class*="breadcrumb"]');
        if (breadcrumb) {
          path = breadcrumb.textContent.replace(/\s+/g, ' ').trim();
        }

        // 检查是否是文件夹类型
        const dataType = element.getAttribute('data-type');
        const isFolder = dataType === '1' ||
                         element.classList.contains('folder') ||
                         element.classList.contains('folder-item');

        if (isFolder || dataType !== '0') {
          folders.push({
            name: name,
            path: path || '当前位置',
            element: element,
          });
        }
      }
    });

    log('找到文件夹数量:', folders.length);
    return folders.slice(0, CONFIG.maxResults);
  }

  /**
   * 尝试使用网盘页面搜索
   */
  async function tryPageSearch(keyword, signal) {
    // 找到网盘搜索框
    const searchSelectors = [
      'input[placeholder*="搜索"]',
      '.search-input',
      '.search-box input',
      'input[type="search"]',
      '.header-search input',
      '[class*="search"] input',
    ];

    let searchInput = null;
    for (const selector of searchSelectors) {
      const input = document.querySelector(selector);
      if (input && isVisible(input)) {
        searchInput = input;
        log('找到网盘搜索框:', selector);
        break;
      }
    }

    if (!searchInput) {
      log('未找到网盘搜索框');
      throw new Error('未找到搜索框');
    }

    // 保存原值
    const originalValue = searchInput.value;

    try {
      // 输入关键词
      searchInput.value = keyword;
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
      searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

      // 等待结果
      await delay(CONFIG.searchWaitTime);

      if (signal.aborted) throw new Error('已取消');

      // 提取结果
      const folders = extractSearchResults(keyword);
      return folders;

    } finally {
      // 恢复原值
      searchInput.value = originalValue;
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  /**
   * 从搜索结果中提取文件夹
   */
  function extractSearchResults(keyword) {
    const folders = [];
    const keywordLower = keyword.toLowerCase();

    const resultSelectors = [
      '.search-result-list .folder',
      '.search-result .folder-item',
      '.result-list [data-type="1"]',
      '.search-list .folder',
      '[class*="result"] .folder',
      '[class*="search"] [data-type="1"]',
    ];

    for (const selector of resultSelectors) {
      const elements = document.querySelectorAll(selector);
      log(`搜索结果选择器 "${selector}": 找到 ${elements.length} 个`);

      if (elements.length > 0) {
        elements.forEach(el => {
          let name = el.getAttribute('title') ||
                     el.getAttribute('data-name') ||
                     el.querySelector('[title]')?.getAttribute('title') ||
                     el.textContent;
          name = name.trim();

          if (name && name.toLowerCase().includes(keywordLower)) {
            folders.push({
              name: name,
              path: '搜索结果',
              element: el,
            });
          }
        });

        if (folders.length > 0) break;
      }
    }

    return folders;
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
          <p class="hint">请确认网盘页面已加载文件夹</p>
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
        // 直接点击
        folder.element.click();
        await delay(CONFIG.navigateDelay);
        showToast(`已进入: ${folder.name}`, 'success');
      } else {
        // 尝试在列表中找到
        const target = findFolderElement(folder.name);
        if (target) {
          target.click();
          await delay(CONFIG.navigateDelay);
          showToast(`已进入: ${folder.name}`, 'success');
        } else {
          showToast('未找到文件夹，请手动操作', 'error');
        }
      }
    } catch (error) {
      log('导航错误:', error);
      showToast('导航失败', 'error');
    }
  }

  function findFolderElement(folderName) {
    const selectors = [
      `[data-name="${folderName}"]`,
      `[data-title="${folderName}"]`,
      `[title="${folderName}"]`,
      `.item-wrapper[title="${folderName}"]`,
      '.item-wrapper',
      '[class*="folder"]',
    ];

    for (const selector of selectors) {
      const elements = document.querySelectorAll(selector);
      for (const el of elements) {
        const name = el.getAttribute('title') ||
                     el.getAttribute('data-name') ||
                     el.getAttribute('data-title') ||
                     el.textContent;
        if (name && name.trim() === folderName) {
          return el;
        }
      }
    }
    return null;
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
    // 延迟初始化
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

    // 打印可用信息，方便调试
    console.log('%c✅ 百度网盘文件夹搜索器已加载', 'color: green; font-weight: bold');
    console.log('%c💡 按 Ctrl+K 打开搜索面板', 'color: blue');
    console.log('%c🔧 如需调试，可在控制台输入 window.baiduSearchDebug()', 'color: orange');
  }

  // 调试函数
  window.baiduSearchDebug = function() {
    console.log('=== 百度网盘文件夹搜索器调试 ===');

    // 搜索框
    const inputs = document.querySelectorAll('input');
    console.log('页面上的 input 元素:', inputs.length);
    inputs.forEach((inp, i) => {
      console.log(`  [${i}] placeholder: "${inp.placeholder}", visible: ${isVisible(inp)}`);
    });

    // 可能的文件夹元素
    const testSelectors = [
      '[data-type="1"]',
      '.folder',
      '.folder-item',
      '.item-wrapper',
    ];

    testSelectors.forEach(sel => {
      const els = document.querySelectorAll(sel);
      console.log(`选择器 "${sel}": ${els.length} 个`);
    });
  };

  init();

})();
