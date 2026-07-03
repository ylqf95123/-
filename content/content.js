/**
 * 百度网盘搜索器 - content.js
 * 版本: v2.0.0 - 同时支持文件和文件夹搜索
 */

(function() {
  'use strict';

  const CONFIG = {
    debounceDelay: 150,
    navigateDelay: 500,
    maxResults: 30,
    debug: true,  // 开启调试
  };

  let isPanelVisible = false;
  let currentResults = [];
  let activeIndex = -1;

  const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  function log(...args) {
    if (CONFIG.debug) {
      console.log('[搜索器]', ...args);
    }
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

  // ============================================
  // DOM 元素创建
  // ============================================
  function createToggleButton() {
    const btn = document.createElement('button');
    btn.id = 'folder-search-toggle';
    btn.innerHTML = '🔍';
    btn.title = '搜索文件/文件夹 (Ctrl+K)';
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
                 placeholder="输入文件名或文件夹名..."
                 autocomplete="off"
                 spellcheck="false">
          <button class="search-clear" title="清除">✕</button>
        </div>
      </div>
      <div class="search-results">
        <div class="search-empty">
          <div class="empty-icon">📂</div>
          <p>输入关键词搜索</p>
          <p class="hint">可搜索文件和文件夹</p>
        </div>
      </div>
      <div class="search-footer">
        <div class="shortcut">
          <span class="key">↑↓</span> 选择
          <span class="key">Enter</span> ${navigator.platform.includes('Mac') ? '⏎' : '进入'} / 选中
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
          <div class="empty-icon">📂</div>
          <p>输入关键词搜索</p>
          <p class="hint">可搜索文件和文件夹</p>
        </div>
      `;
    }

    currentResults = [];
    activeIndex = -1;
  }

  // ============================================
  // 核心搜索功能 - 同时搜索文件和文件夹
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

    const items = searchItems(keyword);
    displayResults(items, keyword);
  }

  /**
   * 搜索文件和文件夹
   */
  function searchItems(keyword) {
    const results = [];
    const keywordLower = keyword.toLowerCase();

    log('开始搜索:', keyword);

    // 获取当前路径
    let currentPath = '当前位置';
    const breadcrumbEl = document.querySelector('[jsaction*="breadcrumb"], .breadcrumb, [class*="breadcrumb"]');
    if (breadcrumbEl) {
      const spans = breadcrumbEl.querySelectorAll('span, a');
      const pathParts = [];
      spans.forEach(el => {
        const text = el.textContent.trim();
        if (text && text.length < 50) {
          pathParts.push(text);
        }
      });
      if (pathParts.length > 0) {
        currentPath = pathParts.join(' > ');
      }
    }

    // 找到所有文件项 - 尝试多种选择器
    let fileItems = document.querySelectorAll('[jsaction*="click:item"]');

    log('找到文件项数量:', fileItems.length);

    // 如果没找到，尝试其他选择器
    if (fileItems.length === 0) {
      fileItems = document.querySelectorAll('[class*="item"], .file-item, .list-item');
      log('使用备用选择器，数量:', fileItems.length);
    }

    fileItems.forEach((item, index) => {
      // 获取图标
      const iconEl = item.querySelector('.u-font-icon');
      const iconText = iconEl ? (iconEl.textContent || '').trim() : '';

      // 判断是文件夹还是文件
      // 📁 文件夹, 📄 文件, 🎬 视频, 🎵 音频, 🖼️ 图片, 📝 文档 等
      const isFolder = iconText.includes('📁');
      const icon = isFolder ? '📁' : (iconText || '📄');

      // 获取文件名 - 尝试多种方式
      let name = '';
      const titleEl = item.querySelector('.title, .name, [class*="title"], [class*="name"]');

      if (titleEl) {
        // 优先使用 title 属性
        name = titleEl.getAttribute('title') || titleEl.textContent;
        name = name.trim();
      }

      // 如果还是没找到，尝试直接获取文本
      if (!name) {
        // 查找包含文本的子元素
        const textEl = item.querySelector('[class*="text"], [class*="content"]');
        if (textEl) {
          name = textEl.textContent.trim();
        }
      }

      // 最后的尝试：直接获取整个项目的文本
      if (!name) {
        const clone = item.cloneNode(true);
        // 移除图标元素
        const icons = clone.querySelectorAll('.u-font-icon, .icon, [class*="icon"]');
        icons.forEach(el => el.remove());
        name = clone.textContent.trim();
      }

      if (!name) {
        log(`[${index}] 无文件名，跳过`);
        return;
      }

      // 匹配关键词
      if (name.toLowerCase().includes(keywordLower)) {
        results.push({
          name: name,
          path: currentPath,
          isFolder: isFolder,
          icon: icon,
          element: item,
          index: index,
        });
        log(`[${index}] 匹配: "${name}", 文件夹: ${isFolder}`);
      }
    });

    log('搜索结果:', results.length, '个');
    return results.slice(0, CONFIG.maxResults);
  }

  /**
   * 显示搜索结果
   */
  function displayResults(items, keyword) {
    const resultsContainer = document.querySelector('.search-results');
    if (!resultsContainer) return;

    currentResults = items;
    activeIndex = items.length > 0 ? 0 : -1;

    if (items.length === 0) {
      resultsContainer.innerHTML = `
        <div class="search-empty">
          <div class="empty-icon">🔍</div>
          <p>未找到匹配的文件或文件夹</p>
          <p class="hint">试试其他关键词</p>
        </div>
      `;
      return;
    }

    let html = '';
    items.forEach((item, index) => {
      const highlightedName = highlightKeyword(item.name, keyword);
      const typeLabel = item.isFolder ? '文件夹' : '文件';
      const hint = item.isFolder ? '↵ 进入' : '↵ 选中';

      html += `
        <div class="result-item ${index === 0 ? 'active' : ''} ${item.isFolder ? 'folder' : 'file'}"
             data-index="${index}">
          <span class="result-icon">${item.icon}</span>
          <div class="result-content">
            <div class="result-name">${highlightedName}</div>
            <div class="result-path">${escapeHtml(item.path)} · ${typeLabel}</div>
          </div>
          <span class="result-hint">${hint}</span>
        </div>
      `;
    });

    resultsContainer.innerHTML = html;

    // 绑定点击事件
    resultsContainer.querySelectorAll('.result-item').forEach(item => {
      item.addEventListener('click', () => {
        const index = parseInt(item.dataset.index, 10);
        selectItem(items[index]);
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
  // 选择/导航功能
  // ============================================
  async function selectItem(item) {
    closePanel();
    showToast(`正在选择: ${item.name}`);

    try {
      if (item.element) {
        item.element.click();
        await delay(CONFIG.navigateDelay);
        showToast(`已选择: ${item.name}`, 'success');
      } else {
        showToast('未找到项目', 'error');
      }
    } catch (error) {
      console.error('选择错误:', error);
      showToast('选择失败', 'error');
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
          selectItem(currentResults[activeIndex]);
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
    log('开始初始化搜索器');

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initUI);
    } else {
      // 延迟初始化，等待网盘加载完成
      setTimeout(initUI, 2000);
    }
  }

  function initUI() {
    // 移除已存在的元素（防止重复）
    const existingPanel = document.getElementById('folder-search-panel');
    const existingBtn = document.getElementById('folder-search-toggle');
    if (existingPanel) existingPanel.remove();
    if (existingBtn) existingBtn.remove();

    createToggleButton();
    createSearchPanel();

    const panel = document.getElementById('folder-search-panel');
    const input = panel.querySelector('.search-input');
    const clearBtn = panel.querySelector('.search-clear');

    // 输入事件 - 带防抖
    let debounceTimer;
    input.addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        performSearch(e.target.value.trim());
      }, CONFIG.debounceDelay);
    });

    // 清除按钮
    clearBtn.addEventListener('click', () => {
      input.value = '';
      clearBtn.classList.remove('visible');
      clearSearch();
      input.focus();
    });

    // 全局键盘事件
    document.addEventListener('keydown', handleKeydown, true);

    // 点击外部关闭
    document.addEventListener('click', (e) => {
      const panel = document.getElementById('folder-search-panel');
      const toggle = document.getElementById('folder-search-toggle');

      if (isPanelVisible && panel && !panel.contains(e.target) && !toggle.contains(e.target)) {
        closePanel();
      }
    });

    console.log('%c✅ 百度网盘搜索器已加载 (v2.0.0)', 'color: green; font-weight: bold');
    console.log('%c💡 按 Ctrl+K 打开搜索面板', 'color: blue');
    console.log('%c📝 可搜索文件和文件夹', 'color: blue');
  }

  // ============================================
  // 调试函数
  // ============================================
  window.baiduSearchDebug = function() {
    console.log('=== 调试信息 ===');

    // 尝试各种选择器
    const selectors = [
      '[jsaction*="click:item"]',
      '[class*="item"]',
      '.file-item',
      '.list-item',
      '[class*="file-list"] > *',
    ];

    selectors.forEach(sel => {
      const items = document.querySelectorAll(sel);
      console.log(`选择器 "${sel}": ${items.length} 个`);
    });

    // 获取页面所有文件项的详细信息
    const allItems = document.querySelectorAll('[jsaction*="click:item"], [class*="item"]');
    console.log('\n文件项详情:');
    allItems.forEach((item, i) => {
      const icon = item.querySelector('.u-font-icon')?.textContent || '';
      const title = item.querySelector('.title')?.getAttribute('title') ||
                    item.querySelector('.title')?.textContent || '';
      const jsaction = item.getAttribute('jsaction') || '';
      console.log(`[${i}] icon="${icon}" title="${title.substring(0, 30)}" jsaction="${jsaction.substring(0, 30)}"`);
    });
  };

  init();

})();
