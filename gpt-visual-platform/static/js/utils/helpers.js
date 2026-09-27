/**
 * 通用工具函数
 */

/**
 * 显示错误信息
 * @param {string} elId - 元素ID
 * @param {string} msg - 错误信息
 */
export function setLoadError(elId, msg) {
  const el = document.getElementById(elId);
  if (el) {
    el.innerHTML = '<p class="text-red-600">' + msg + '</p>';
  }
}

/**
 * 加载用户设置
 * @returns {Object} 用户设置对象
 */
export function loadUserSettings() {
  try {
    const settings = localStorage.getItem('userSettings');
    return settings ? JSON.parse(settings) : {
      refreshInterval: '5000',
      animationsEnabled: true,
      darkModeEnabled: false
    };
  } catch (error) {
    console.error('加载用户设置失败:', error);
    return {
      refreshInterval: '5000',
      animationsEnabled: true,
      darkModeEnabled: false
    };
  }
}

/**
 * 保存用户设置
 * @param {Object} settings - 用户设置对象
 */
export function saveUserSettings(settings) {
  try {
    localStorage.setItem('userSettings', JSON.stringify(settings));
    
    // 应用深色模式
    if (settings.darkModeEnabled) {
      document.body.classList.add('dark-mode');
    } else {
      document.body.classList.remove('dark-mode');
    }
    
    // 应用动画设置
    if (!settings.animationsEnabled) {
      document.body.classList.add('reduce-motion');
    } else {
      document.body.classList.remove('reduce-motion');
    }
    
  } catch (error) {
    console.error('保存用户设置失败:', error);
  }
}

/**
 * 初始化用户设置
 */
export function initUserSettings() {
  const settings = loadUserSettings();
  
  // 应用深色模式
  if (settings.darkModeEnabled) {
    document.body.classList.add('dark-mode');
  }
  
  // 应用动画设置
  if (!settings.animationsEnabled) {
    document.body.classList.add('reduce-motion');
  }
}

/**
 * 打开模态框
 * @param {string} title - 模态框标题
 * @param {string} content - 模态框内容
 */
export function openModal(title, content) {
  const modal = document.createElement('div');
  modal.id = 'modal';
  modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
  modal.innerHTML = `
    <div class="bg-white rounded-lg shadow-xl max-w-md w-full max-h-[80vh] overflow-y-auto">
      <div class="flex justify-between items-center border-b border-gray-200 p-4">
        <h2 class="text-lg font-semibold">${title}</h2>
        <button class="text-gray-400 hover:text-gray-600">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div class="p-4">
        ${content}
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // 绑定关闭按钮事件
  const closeButton = modal.querySelector('button');
  if (closeButton) {
    closeButton.addEventListener('click', function() {
      modal.remove();
    });
  }
  
  // 点击模态框外部关闭
  modal.addEventListener('click', function(e) {
    if (e.target === modal) {
      modal.remove();
    }
  });
}
