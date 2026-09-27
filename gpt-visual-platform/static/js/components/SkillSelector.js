/**
 * 技能选择组件模块
 * 处理技能选择列表和相关功能
 */
import apiService from '../services/apiService.js?v=13';
import renderService from '../services/renderService.js?v=13';

// 技能选择相关功能
let allSkills = [];

/**
 * 加载技能列表
 */
export async function loadSkillsList() {
  try {
    const skillsData = await apiService.getSkills();
    allSkills = skillsData.items || [];
    renderSkillsList(allSkills);
    bindSkillsEvents();
  } catch (error) {
    console.error('加载技能列表失败:', error);
    document.getElementById('skills-list').innerHTML = '<div class="text-red-600 text-sm">加载技能失败</div>';
  }
}

/**
 * 渲染技能列表
 * @param {Array} skills - 技能列表
 */
export function renderSkillsList(skills) {
  const container = document.getElementById('skills-list');
  // 使用虚拟滚动渲染
  renderService.renderSkillsListWithVirtualScroll(skills, container);
}

/**
 * 绑定技能选择事件
 */
export function bindSkillsEvents() {
  // 全选/取消全选事件
  const selectAllCheckbox = document.getElementById('select-all-skills');
  if (selectAllCheckbox) {
    selectAllCheckbox.addEventListener('change', function() {
      const checkboxes = document.querySelectorAll('.skill-checkbox');
      checkboxes.forEach(checkbox => {
        checkbox.checked = this.checked;
      });
      updateSelectedSkills();
    });
  }
  
  // 单个技能选择事件
  document.addEventListener('change', function(e) {
    if (e.target.classList.contains('skill-checkbox')) {
      updateSelectedSkills();
      updateSelectAllStatus();
    }
  });
}

/**
 * 更新选中的技能
 */
export function updateSelectedSkills() {
  const selectedCheckboxes = document.querySelectorAll('.skill-checkbox:checked');
  const selectedSkillIds = Array.from(selectedCheckboxes).map(checkbox => checkbox.dataset.skillId);
  const selectedSkillNames = selectedSkillIds.map(id => {
    const skill = allSkills.find(s => s.id === id);
    return skill ? skill.name : id;
  });
  
  document.getElementById('selected-skills').value = selectedSkillNames.join(',');
}

/**
 * 更新全选状态
 */
export function updateSelectAllStatus() {
  const selectAllCheckbox = document.getElementById('select-all-skills');
  const checkboxes = document.querySelectorAll('.skill-checkbox');
  const checkedBoxes = document.querySelectorAll('.skill-checkbox:checked');
  
  if (checkboxes.length === 0) {
    selectAllCheckbox.checked = false;
    selectAllCheckbox.indeterminate = false;
  } else if (checkboxes.length === checkedBoxes.length) {
    selectAllCheckbox.checked = true;
    selectAllCheckbox.indeterminate = false;
  } else if (checkedBoxes.length === 0) {
    selectAllCheckbox.checked = false;
    selectAllCheckbox.indeterminate = false;
  } else {
    selectAllCheckbox.checked = false;
    selectAllCheckbox.indeterminate = true;
  }
}

/**
 * 重置技能选择
 */
export function resetSkillsSelection() {
  document.getElementById('select-all-skills').checked = false;
  document.getElementById('select-all-skills').indeterminate = false;
  const checkboxes = document.querySelectorAll('.skill-checkbox');
  checkboxes.forEach(checkbox => {
    checkbox.checked = false;
  });
  document.getElementById('selected-skills').value = '';
}
