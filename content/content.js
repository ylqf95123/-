/**
 * 百度网盘文件夹搜索器 - content.js
 * 版本: v1.0.4 - 详细调试版
 */

(function() {
  'use strict';

  // ============================================
  // 配置
  // ============================================
  const CONFIG = {
    debounceDelay: 200,
    searchWaitTime: 800,
    navigateDelay: 500,
    maxResults: 30,
    debug: true,  // 开启调试
  };

  // ============================================
  // 状态
  // ============================================
  let isPanelVisible = false;
  let currentResults = [];
  let activeIndex = -1;

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
  // 核心搜索功能
  // ============================================
  async function performSearch(keyword) {
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

    log('开始搜索:', keyword);
    const folders = searchFolders(keyword);
    log('找到文件夹:', folders.length);
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
    log('当前路径:', currentPath);

    // 找到所有带图标的项
    const iconElements = document.querySelectorAll('.u-font-icon');
    log('.u-font-icon 总数:', iconElements.length);

    iconElements.forEach((icon, index) => {
      // 获取图标内容
      const iconText = icon.textContent || '';
      const isFolder = iconText.includes('📁');

      log(`[${index}] 图标: "${iconText}", isFolder: ${isFolder}`);

      if (!isFolder) return;

      // 获取父级文件项元素
      let fileItem = icon.closest('[jsaction]');
      if (!fileItem) {
        // 备用方法：向上找两级
        fileItem = icon.parentElement?.parentElement;
      }

      log(`[${index}] fileItem:`, fileItem ? '找到' : '未找到');

      if (!fileItem) return;

      // 获取文件名
      let name = '';
      const titleEl = fileItem.querySelector('.title');
      log(`[${index}] .title 元素:`, titleEl ? '找到' : '未找到');

      if (titleEl) {
        name = titleEl.getAttribute('title') || titleEl.textContent;
        log(`[${index}] title 属性值:`, titleEl.getAttribute('title'));
        log(`[${index}] title 文本内容:`, titleEl.textContent);
      }

      // 备用方法
      if (!name) {
        name = fileItem.getAttribute('title') || '';
        log(`[${index}] 备用 name:`, name);
      }

      name = name.trim();
      log(`[${index}] 最终 name: "${name}"`);

      // 匹配关键词
      if (name && name.toLowerCase().includes(keywordLower)) {
        log(`[${index}] ✅ 匹配成功!`);
        folders.push({
          name: name,
          path: currentPath,
          element: fileItem,
        });
      }
    });

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
          <p class="hint">请查看控制台调试信息</p>
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
    // Ctrl/Cmd + K
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

    console.log('%c✅ 百度网盘文件夹搜索器已加载 (v1.0.4)', 'color: green; font-weight: bold');
  }

  // 详细调试
  window.baiduSearchDebug = function() {
    console.log('========== 详细调试 ==========');

    const iconElements = document.querySelectorAll('.u-font-icon');
    console.log('.u-font-icon 总数:', iconElements.length);

    iconElements.forEach((icon, i) => {
      const iconText = icon.textContent || '';
      const isFolder = iconText.includes('📁');

      let fileItem = icon.closest('[jsaction]') || icon.parentElement?.parentElement;
      let name = '';
      let titleEl = null;

      if (fileItem) {
        titleEl = fileItem.querySelector('.title');
        if (titleEl) {
          name = titleEl.getAttribute('title') || titleEl.textContent;
        }
      }

      console.log(`\n[${i}] ==========`);
      console.log(`图标: "${iconText}"`);
      console.log(`是文件夹: ${isFolder}`);
      console.log(`fileItem:`, fileItem ? fileItem.className.substring(0, 50) : 'null');
      console.log(`.title 元素:`, titleEl ? '有' : '无');
      console.log(`获取到的名称: "${name}"`);
      console.log(`HTML 结构:`, fileItem?.outerHTML?.substring(0, 200));
    });

    console.log('\n========== 面包屑 ==========');
    const breadcrumb = document.querySelector('[jsaction="breadcrumb"]');
    console.log('面包屑:', breadcrumb?.textContent?.trim());
  };

  init();

})();
