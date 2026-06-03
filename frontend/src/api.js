import axios from 'axios';

const API_BASE_URL = 'http://127.0.0.1:8000';

export const api = {
  getAgents: () => axios.get(`${API_BASE_URL}/agents/`).then(res => res.data),
  createAgent: (agentData) => axios.post(`${API_BASE_URL}/agents/`, agentData).then(res => res.data),
  updateAgent: (id, agentData) => axios.put(`${API_BASE_URL}/agents/${id}`, agentData).then(res => res.data),
  deleteAgent: (id) => axios.delete(`${API_BASE_URL}/agents/${id}`).then(res => res.data),
  chatWithAgent: (id, message, threadId) => 
    axios.post(`${API_BASE_URL}/agents/${id}/chat`, {
      thread_id: threadId || `sandbox_agent_${id}`,
      message: message,
      sender_id: "web_user"
    }).then(res => res.data),
  getChatHistory: (id, threadId) => 
    axios.get(`${API_BASE_URL}/agents/${id}/chat?thread_id=${threadId || `sandbox_agent_${id}`}`)
      .then(res => res.data),
  runWorkflow: (payload) => 
    axios.post(`${API_BASE_URL}/agents/workflow/execute`, payload).then(res => res.data),
  getTelemetryLogs: () => axios.get(`${API_BASE_URL}/agents/telemetry/logs`).then(res => res.data),
  getTelemetryStats: () => axios.get(`${API_BASE_URL}/agents/telemetry/stats`).then(res => res.data),
  saveWorkflow: (payload) => axios.post(`${API_BASE_URL}/agents/workflows/`, payload).then(res => res.data),
  listWorkflows: () => axios.get(`${API_BASE_URL}/agents/workflows/`).then(res => res.data),
  getWorkflow: (id) => axios.get(`${API_BASE_URL}/agents/workflows/${id}`).then(res => res.data),
  deleteWorkflow: (id) => axios.delete(`${API_BASE_URL}/agents/workflows/${id}`).then(res => res.data),
  activateTelegramWorkflow: (id) => axios.post(`${API_BASE_URL}/agents/workflows/${id}/activate_telegram`).then(res => res.data),
  deactivateTelegramWorkflows: () => axios.post(`${API_BASE_URL}/agents/workflows/deactivate_telegram`).then(res => res.data),
};