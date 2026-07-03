/**
 * 百度网盘文件夹搜索器 - content.js
 *
 * 功能：
 * 1. 创建悬浮搜索面板
 * 2. 劫持网盘页面搜索功能
 * 3. 展示文件夹搜索结果
 * 4. 点击结果自动导航到目标文件夹
 */

(function() {
  'use strict';

  // ============================================
  // 配置
  // ============================================
  const CONFIG = {
    // 搜索防抖延迟 (ms)
    debounceDelay: 300,
    // 搜索结果等待时间 (ms)
    searchWaitTime: 800,
    // 导航时每个层级等待时间 (ms)
    navigateDelay: 400,
    // 最大显示结果数
    maxResults: 50,
  };

  // ============================================
  // 状态
  // ============================================
  let isPanelVisible = false;
  let currentResults = [];
  let activeIndex = -1;
  let searchDebounceTimer = null;
  let searchAbortController = null;

  // ============================================
  // 工具函数
  // ============================================

  /**
   * 延迟函数
   */
  const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  /**
   * 防抖函数
   */
  function debounce(fn, delay) {
    let timer = null;
    return function(...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  /**
   * 高亮关键词
   */
  function highlightKeyword(text, keyword) {
    if (!keyword) return text;
    const regex = new RegExp(`(${escapeRegExp(keyword)})`, 'gi');
    return text.replace(regex, '<mark>$1</mark>');
  }

  /**
   * 转义正则特殊字符
   */
  function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * 显示提示消息
   */
  function showToast(message, type = 'info') {
    // 移除已有的 toast
    const existingToast = document.querySelector('.search-toast');
    if (existingToast) existingToast.remove();

    const toast = document.createElement('div');
    toast.className = `search-toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => toast.remove(), 2500);
  }

  // ============================================
  // DOM 元素创建
  // ============================================

  /**
   * 创建悬浮切换按钮
   */
  function createToggleButton() {
    const btn = document.createElement('button');
    btn.id = 'folder-search-toggle';
    btn.innerHTML = '🔍';
    btn.title = '文件夹搜索 (Ctrl+K)';
    btn.addEventListener('click', togglePanel);
    document.body.appendChild(btn);
    return btn;
  }

  /**
   * 创建搜索面板
   */
  function createSearchPanel() {
    const panel = document.createElement('div');
    panel.id = 'folder-search-panel';
    panel.innerHTML = `
      <div class="search-header">
        <span class="search-icon">🔍</span>
        <div class="search-input-wrapper">
          <input type="text"
                 class="search-input"
                 placeholder="搜索文件夹名称..."
                 autocomplete="off"
                 spellcheck="false">
          <button class="search-clear" title="清除">✕</button>
        </div>
      </div>
      <div class="search-results">
        <div class="search-empty">
          <div class="empty-icon">📁</div>
          <p>输入关键词搜索文件夹</p>
          <p class="hint">支持模糊匹配，搜索结果自动高亮</p>
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

  /**
   * 切换面板显示/隐藏
   */
  function togglePanel() {
    const panel = document.getElementById('folder-search-panel');
    const toggle = document.getElementById('folder-search-toggle');

    if (!panel || !toggle) return;

    isPanelVisible = !isPanelVisible;

    if (isPanelVisible) {
      panel.classList.add('visible');
      panel.querySelector('.search-input').focus();
    } else {
      panel.classList.remove('visible');
      // 清除搜索状态
      clearSearch();
    }
  }

  /**
   * 关闭面板
   */
  function closePanel() {
    const panel = document.getElementById('folder-search-panel');
    if (panel) {
      panel.classList.remove('visible');
      isPanelVisible = false;
      clearSearch();
    }
  }

  /**
   * 清除搜索
   */
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
          <p class="hint">支持模糊匹配，搜索结果自动高亮</p>
        </div>
      `;
    }

    currentResults = [];
    activeIndex = -1;

    // 取消正在进行的搜索
    if (searchAbortController) {
      searchAbortController.abort();
      searchAbortController = null;
    }
  }

  // ============================================
  // 搜索功能
  // ============================================

  /**
   * 执行搜索
   */
  async function performSearch(keyword) {
    if (!keyword || keyword.trim() === '') {
      clearSearch();
      return;
    }

    // 取消之前的搜索
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
      // 方案1: 尝试使用网盘页面自带的搜索
      const folders = await searchViaPageSearch(keyword, searchAbortController.signal);

      // 显示结果
      displayResults(folders, keyword);

    } catch (error) {
      if (error.name === 'AbortError') {
        // 搜索被取消，忽略
        return;
      }

      // 降级方案: 遍历当前可见的文件夹
      console.log('页面搜索失败，尝试DOM遍历:', error);
      const folders = searchViaDOM(keyword);
      displayResults(folders, keyword);
    }
  }

  /**
   * 通过网盘页面搜索功能搜索
   */
  async function searchViaPageSearch(keyword, signal) {
    // 找到网盘页面的搜索框
    const searchInput = findBaiduSearchInput();

    if (!searchInput) {
      throw new Error('未找到网盘搜索框');
    }

    // 记录原始值
    const originalValue = searchInput.value;
    const originalPlaceholder = searchInput.getAttribute('placeholder');

    try {
      // 模拟用户输入
      searchInput.value = keyword;

      // 触发 input 事件
      const inputEvent = new Event('input', { bubbles: true, cancelable: true });
      searchInput.dispatchEvent(inputEvent);

      // 触发 search 事件 (某些网盘可能使用)
      const searchEvent = new Event('search', { bubbles: true, cancelable: true });
      searchInput.dispatchEvent(searchEvent);

      // 等待搜索结果出现
      await delay(CONFIG.searchWaitTime);

      // 检查是否被取消
      if (signal.aborted) {
        throw new Error('搜索已取消');
      }

      // 从页面提取文件夹结果
      const folders = extractFoldersFromResults();

      return folders;

    } finally {
      // 恢复原始值
      searchInput.value = originalValue;
      searchInput.setAttribute('placeholder', originalPlaceholder || '');
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  /**
   * 通过 DOM 遍历搜索（降级方案）
   */
  function searchViaDOM(keyword) {
    const folders = [];
    const keywordLower = keyword.toLowerCase();

    // 尝试多种选择器来匹配网盘的文件夹元素
    const selectors = [
      // 左侧文件列表
      '.file-list .folder-item',
      '.file-list-item[data-type="folder"]',
      '.wp-s-core-pan .list-item[data-type="folder"]',
      // 搜索结果
      '.search-result-list .folder',
      '.search-result .folder-item',
      // 通用选择器
      '[data-type="folder"]',
      '.folder-item',
      '.item-wrapper[data-type="1"]',
    ];

    let folderElements = [];

    for (const selector of selectors) {
      folderElements = document.querySelectorAll(selector);
      if (folderElements.length > 0) break;
    }

    folderElements.forEach(element => {
      // 获取文件夹名称
      const nameEl = element.querySelector('.name, .file-name, .text, [title]') || element;
      const name = nameEl.textContent || nameEl.getAttribute('title') || '';

      if (name.toLowerCase().includes(keywordLower)) {
        // 获取路径信息
        const pathEl = element.querySelector('.path, .location, .bread-crumb');
        const path = pathEl ? pathEl.textContent : '';

        folders.push({
          name: name.trim(),
          path: path.trim() || '当前位置',
          element: element,
        });
      }
    });

    return folders.slice(0, CONFIG.maxResults);
  }

  /**
   * 查找百度网盘搜索框
   */
  function findBaiduSearchInput() {
    const selectors = [
      // 主搜索框
      '.search-input',
      '.search-input-wrapper input',
      'input[placeholder*="搜索"]',
      // 可能的选择器
      '.wp-s-search__input',
      '.search-container input',
      // 更通用的
      'input[type="search"]',
    ];

    for (const selector of selectors) {
      const input = document.querySelector(selector);
      if (input && isVisible(input)) {
        return input;
      }
    }

    return null;
  }

  /**
   * 从搜索结果中提取文件夹
   */
  function extractFoldersFromResults() {
    const folders = [];

    // 尝试多种选择器来匹配搜索结果中的文件夹
    const selectors = [
      // 搜索结果列表
      '.search-result-list .folder',
      '.search-result .folder-item',
      '.list-wrapper .folder-item',
      '.result-list .item[data-type="folder"]',
      // 更通用的
      '[data-type="folder"]',
      '.folder',
      '.wp-s-core-pan .list-item.is-folder',
    ];

    for (const selector of selectors) {
      const elements = document.querySelectorAll(selector);

      elements.forEach(element => {
        const nameEl = element.querySelector('.name, .filename, .title, [title]') || element;
        let name = nameEl.textContent || nameEl.getAttribute('title') || '';

        // 清理名称
        name = name.trim();

        if (name) {
          // 获取路径
          const pathEl = element.querySelector('.path, .location, .bread-crumb');
          const path = pathEl ? pathEl.textContent : '';

          folders.push({
            name: name,
            path: path.trim(),
            element: element,
          });
        }
      });

      if (folders.length > 0) break;
    }

    return folders.slice(0, CONFIG.maxResults);
  }

  /**
   * 判断元素是否可见
   */
  function isVisible(element) {
    const style = window.getComputedStyle(element);
    return style.display !== 'none' &&
           style.visibility !== 'hidden' &&
           element.offsetParent !== null;
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
          <p class="hint">尝试其他关键词</p>
        </div>
      `;
      return;
    }

    // 渲染结果列表
    let html = '';
    folders.forEach((folder, index) => {
      const highlightedName = highlightKeyword(folder.name, keyword);
      const displayPath = folder.path || '当前位置';

      html += `
        <div class="result-item ${index === 0 ? 'active' : ''}"
             data-index="${index}"
             data-path="${escapeHtml(folder.path)}">
          <span class="result-icon">📁</span>
          <div class="result-content">
            <div class="result-name">${highlightedName}</div>
            <div class="result-path">${escapeHtml(displayPath)}</div>
          </div>
          <span class="result-hint">Enter ↵</span>
        </div>
      `;
    });

    resultsContainer.innerHTML = html;

    // 绑定点击事件
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

  /**
   * 转义 HTML 特殊字符
   */
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * 更新激活项索引
   */
  function updateActiveIndex(newIndex) {
    activeIndex = newIndex;

    document.querySelectorAll('.result-item').forEach((item, index) => {
      item.classList.toggle('active', index === activeIndex);
    });
  }

  // ============================================
  // 导航功能
  // ============================================

  /**
   * 导航到目标文件夹
   */
  async function navigateToFolder(folder) {
    closePanel();
    showToast(`正在进入: ${folder.name}`, 'info');

    try {
      // 方式1: 直接点击结果项
      if (folder.element && isVisible(folder.element)) {
        folder.element.click();
        await delay(500);
        showToast(`已进入: ${folder.name}`, 'success');
        return;
      }

      // 方式2: 尝试在文件列表中找到并点击
      const targetFolder = findFolderInList(folder.name);
      if (targetFolder) {
        targetFolder.click();
        await delay(500);
        showToast(`已进入: ${folder.name}`, 'success');
        return;
      }

      // 方式3: 触发网盘导航
      await navigateViaSearch(folder);

    } catch (error) {
      console.error('导航失败:', error);
      showToast('导航失败，请手动进入文件夹', 'error');
    }
  }

  /**
   * 在文件列表中找到文件夹并点击
   */
  function findFolderInList(folderName) {
    // 尝试多种选择器
    const selectors = [
      `.item-wrapper[title="${folderName}"]`,
      `.list-item[title="${folderName}"]`,
      `.file-item[title="${folderName}"]`,
      `[data-name="${folderName}"]`,
      // 文本匹配
      '.list-item',
      '.item-wrapper',
      '.file-item',
    ];

    for (const selector of selectors) {
      const items = document.querySelectorAll(selector);

      for (const item of items) {
        const title = item.getAttribute('title') ||
                      item.querySelector('[title]')?.getAttribute('title') ||
                      item.textContent;

        if (title && title.trim() === folderName.trim()) {
          return item;
        }
      }
    }

    return null;
  }

  /**
   * 通过搜索触发导航
   */
  async function navigateViaSearch(folder) {
    // 使用网盘搜索功能定位
    const searchInput = findBaiduSearchInput();

    if (searchInput) {
      searchInput.value = folder.name;
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));

      await delay(800);

      // 查找并点击结果
      const target = findFolderInList(folder.name);
      if (target) {
        target.click();
        showToast(`已进入: ${folder.name}`, 'success');
        return;
      }
    }

    showToast('未能自动导航，请手动查找', 'error');
  }

  // ============================================
  // 键盘事件处理
  // ============================================

  /**
   * 处理键盘事件
   */
  function handleKeydown(e) {
    // Ctrl/Cmd + K: 打开/关闭面板
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      togglePanel();
      return;
    }

    // 面板未打开时，不处理其他按键
    if (!isPanelVisible) return;

    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        closePanel();
        break;

      case 'ArrowDown':
        e.preventDefault();
        if (currentResults.length > 0) {
          const newIndex = Math.min(activeIndex + 1, currentResults.length - 1);
          updateActiveIndex(newIndex);
          scrollActiveIntoView();
        }
        break;

      case 'ArrowUp':
        e.preventDefault();
        if (currentResults.length > 0) {
          const newIndex = Math.max(activeIndex - 1, 0);
          updateActiveIndex(newIndex);
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

  /**
   * 滚动激活项到可视区域
   */
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
    // 等待页面加载完成
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initUI);
    } else {
      // 延迟初始化，确保网盘页面已渲染
      setTimeout(initUI, 1000);
    }
  }

  function initUI() {
    // 创建 UI 元素
    createToggleButton();
    createSearchPanel();

    // 获取元素引用
    const panel = document.getElementById('folder-search-panel');
    const input = panel.querySelector('.search-input');
    const clearBtn = panel.querySelector('.search-clear');

    // 绑定搜索输入事件
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

    // 全局键盘事件
    document.addEventListener('keydown', handleKeydown);

    // 点击外部关闭面板
    document.addEventListener('click', (e) => {
      const panel = document.getElementById('folder-search-panel');
      const toggle = document.getElementById('folder-search-toggle');

      if (isPanelVisible &&
          panel &&
          !panel.contains(e.target) &&
          !toggle.contains(e.target)) {
        closePanel();
      }
    });

    console.log('✅ 百度网盘文件夹搜索器已初始化');
    console.log('💡 按 Ctrl+K 打开搜索面板');
  }

  // 启动
  init();

})();
