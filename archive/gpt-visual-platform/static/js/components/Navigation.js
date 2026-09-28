/**
 * 导航组件模块
 * 处理导航按钮事件和相关功能
 */
import { openModal, loadUserSettings, saveUserSettings } from '../utils/helpers.js?v=13';

/**
 * 绑定导航按钮事件
 */
export function bindNavigationEvents() {
  // 文档按钮点击事件
  const docsButton = document.querySelector('header .apple-button:nth-child(1)');
  if (docsButton) {
    docsButton.addEventListener('click', function() {
      openModal('文档', `
            <div class="space-y-4">
              <h3 class="text-lg font-semibold">使用文档</h3>
              <div class="space-y-2">
                <p class="text-sm">本平台提供以下功能：</p>
                <ul class="list-disc list-inside text-sm space-y-1">
                  <li>技能管理 - 查看和管理可用测试技能</li>
                  <li>Agent管理 - 查看已注册的测试执行器</li>
                  <li>任务管理 - 创建和监控测试任务</li>
                  <li>MCP集成 - 与Unity编辑器交互</li>
                </ul>
                <p class="text-sm mt-4">使用步骤：</p>
                <ol class="list-decimal list-inside text-sm space-y-1">
                  <li>在各环境运行对应runner脚本注册Agent</li>
                  <li>在"创建任务"表单中配置测试参数</li>
                  <li>选择所需技能</li>
                  <li>点击"创建任务"按钮提交</li>
                  <li>在"任务列表"中查看执行状态</li>
                </ol>
              </div>
            </div>
          `);
    });
  }
  
  // 设置按钮点击事件
  const settingsButton = document.querySelector('header .apple-button:nth-child(2)');
  if (settingsButton) {
    settingsButton.addEventListener('click', function() {
      // 加载用户偏好设置
      const userSettings = loadUserSettings();
      
      openModal('设置', `
            <div class="space-y-4">
              <h3 class="text-lg font-semibold">平台设置</h3>
              <div class="space-y-4">
                <div>
                  <label for="refresh-interval" class="block text-sm font-medium text-gray-700 mb-2">自动刷新间隔</label>
                  <select id="refresh-interval" class="apple-select w-full">
                    <option value="3000" ${userSettings.refreshInterval === '3000' ? 'selected' : ''}>3秒</option>
                    <option value="5000" ${userSettings.refreshInterval === '5000' ? 'selected' : ''}>5秒</option>
                    <option value="10000" ${userSettings.refreshInterval === '10000' ? 'selected' : ''}>10秒</option>
                    <option value="30000" ${userSettings.refreshInterval === '30000' ? 'selected' : ''}>30秒</option>
                  </select>
                  <p class="text-xs text-gray-400 mt-1.5">任务列表与 Agent 状态的刷新频率，保存后立即生效。</p>
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-2">动画效果</label>
                  <div class="flex items-center py-1">
                    <input type="checkbox" id="animations-toggle" ${userSettings.animationsEnabled ? 'checked' : ''} class="mr-3 text-blue-500 focus:ring-blue-200 border-gray-200 rounded" />
                    <label for="animations-toggle" class="text-sm text-gray-700 cursor-pointer">启用动画效果</label>
                  </div>
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-2">深色模式</label>
                  <div class="flex items-center py-1">
                    <input type="checkbox" id="dark-mode-toggle" ${userSettings.darkModeEnabled ? 'checked' : ''} class="mr-3 text-blue-500 focus:ring-blue-200 border-gray-200 rounded" />
                    <label for="dark-mode-toggle" class="text-sm text-gray-700 cursor-pointer">启用深色模式</label>
                  </div>
                </div>
              </div>
              <div class="pt-4 border-t border-gray-200">
                <button id="save-settings" class="apple-button px-4 py-2 text-sm">保存设置</button>
              </div>
            </div>
          `);
      
      // 绑定保存设置按钮事件
      setTimeout(() => {
        const saveButton = document.getElementById('save-settings');
        if (saveButton) {
          saveButton.addEventListener('click', function() {
            const refreshInterval = document.getElementById('refresh-interval').value;
            const animationsEnabled = document.getElementById('animations-toggle').checked;
            const darkModeEnabled = document.getElementById('dark-mode-toggle').checked;
            
            const settings = {
              refreshInterval,
              animationsEnabled,
              darkModeEnabled
            };
            
            saveUserSettings(settings);
            // 通知页面热生效（如重启自动刷新定时器）
            window.dispatchEvent(new CustomEvent('settings:saved', { detail: settings }));

            const modal = document.getElementById('modal');
            if (modal) {
              modal.remove();
            }
          });
        }
      }, 100);
    });
  }
}
