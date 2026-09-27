/**
 * API 服务模块
 * 封装所有前端API调用，提供统一的接口服务
 */

class ApiService {
  constructor(baseUrl = '') {
    this.baseUrl = baseUrl;
  }

  /**
   * 通用GET请求方法
   * @param {string} path - API路径
   * @returns {Promise<any>} - 返回API响应数据
   */
  async get(path) {
    try {
      const response = await fetch(this.baseUrl + path, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      console.error('API GET 请求失败:', error);
      throw error;
    }
  }

  /**
   * 通用POST请求方法
   * @param {string} path - API路径
   * @param {object} body - 请求体数据
   * @returns {Promise<any>} - 返回API响应数据
   */
  async post(path, body) {
    try {
      const response = await fetch(this.baseUrl + path, {
        method: 'POST',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      console.error('API POST 请求失败:', error);
      throw error;
    }
  }

  /**
   * 获取技能列表
   * @returns {Promise<any>} - 技能列表数据
   */
  async getSkills() {
    return this.get('/api/skills');
  }

  /**
   * 获取Agent列表
   * @returns {Promise<any>} - Agent列表数据
   */
  async getAgents() {
    return this.get('/api/agents');
  }

  /**
   * 获取任务列表
   * @returns {Promise<any>} - 任务列表数据
   */
  async getJobs() {
    return this.get('/api/jobs');
  }

  /**
   * 获取单个任务详情
   * @param {number} jobId - 任务ID
   * @returns {Promise<any>} - 任务详情数据
   */
  async getJob(jobId) {
    return this.get(`/api/jobs/${jobId}`);
  }

  /**
   * 创建新任务
   * @param {object} jobData - 任务数据
   * @returns {Promise<any>} - 创建结果
   */
  async createJob(jobData) {
    return this.post('/api/jobs', jobData);
  }

  /**
   * 数据管理：清理全部终态任务
   */
  async cleanupJobs() {
    return this.post('/api/jobs/cleanup', {});
  }

  /**
   * 取消任务（pending/running → cancelled）
   */
  async cancelJob(jobId) {
    return this.post(`/api/jobs/${jobId}/cancel`, {});
  }

  /**
   * 删除任务
   */
  async deleteJob(jobId) {
    const response = await fetch(`${this.baseUrl}/api/jobs/${jobId}`, { method: 'DELETE', cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    return response.json();
  }

  /**
   * 任务产物列表（执行记录文件）
   */
  async getArtifacts(jobId) {
    return this.get(`/api/jobs/artifacts?job_id=${jobId}`);
  }

  /**
   * 读取单个产物文本内容
   */
  async getArtifactText(jobId, name) {
    const response = await fetch(`${this.baseUrl}/api/jobs/artifacts/${encodeURIComponent(name)}?job_id=${jobId}`, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    return response.text();
  }

  /**
   * 轮询任务
   * @param {string} platform - 平台名称
   * @param {string} skills - 技能列表（逗号分隔）
   * @returns {Promise<any>} - 任务数据
   */
  async pollJob(platform, skills = '') {
    const params = new URLSearchParams();
    if (skills) {
      params.append('skills', skills);
    }
    const queryString = params.toString();
    const path = `/api/jobs/poll/${platform}${queryString ? `?${queryString}` : ''}`;
    return this.get(path);
  }

  /**
   * 提交任务结果
   * @param {object} resultData - 结果数据
   * @returns {Promise<any>} - 提交结果
   */
  async submitJobResult(resultData) {
    return this.post('/api/jobs/result', resultData);
  }

  /**
   * 注册Agent
   * @param {object} agentData - Agent数据
   * @returns {Promise<any>} - 注册结果
   */
  async registerAgent(agentData) {
    return this.post('/api/agents/register', agentData);
  }

  /**
   * Agent心跳
   * @param {object} heartbeatData - 心跳数据
   * @returns {Promise<any>} - 心跳结果
   */
  async agentHeartbeat(heartbeatData) {
    return this.post('/api/agents/heartbeat', heartbeatData);
  }

  /**
   * 获取MCP状态
   * @returns {Promise<any>} - MCP状态数据
   */
  async getMcpStatus() {
    return this.get('/api/mcp/status');
  }

  /**
   * 执行MCP工具
   * @param {object} toolData - 工具执行数据
   * @returns {Promise<any>} - 执行结果
   */
  async executeMcpTool(toolData) {
    return this.post('/api/mcp/execute-tool', toolData);
  }

  /**
   * 批量执行MCP工具
   * @param {object} batchData - 批量执行数据
   * @returns {Promise<any>} - 执行结果
   */
  async batchExecuteMcpTools(batchData) {
    return this.post('/api/mcp/batch-execute', batchData);
  }

  /**
   * 设置活动的MCP实例
   * @param {object} instanceData - 实例数据
   * @returns {Promise<any>} - 设置结果
   */
  async setActiveMcpInstance(instanceData) {
    return this.post('/api/mcp/set-active-instance', instanceData);
  }

  /**
   * 生成测试用例
   * @param {object} testData - 测试用例生成数据
   * @returns {Promise<any>} - 生成结果
   */
  async generateTest(testData) {
    return this.post('/api/generate-test', testData);
  }
}

// 导出单例实例
const apiService = new ApiService();
export default apiService;
