import { useState, useEffect } from 'react';
import { api } from './api';
import WorkflowBuilder from './WorkflowBuilder';

export default function App() {
  const [agents, setAgents] = useState([]);
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalTab, setModalTab] = useState('basic');

  // Chat state
  const [chatInput, setChatInput] = useState('');
  const [messages, setMessages] = useState([]);
  const [isChatLoading, setIsChatLoading] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    name: '', role: '', system_prompt: '', model: 'gemma-4-26b-a4b-it', max_tokens: 1000, tools: [], channels: ['web'],
    config: { skills: [], interaction_rules: [], guardrails: [] }
  });
  const [editingAgentId, setEditingAgentId] = useState(null);

  const [currentView, setCurrentView] = useState('dashboard'); // 'dashboard', 'workflows', or 'telemetry'
  
  // Telemetry Dashboard state
  const [telemetryLogs, setTelemetryLogs] = useState([]);
  const [telemetryStats, setTelemetryStats] = useState(null);
  const [activeTelemetryLog, setActiveTelemetryLog] = useState(null);
  const [isTelemetryLoading, setIsTelemetryLoading] = useState(false);

  const loadTelemetry = async () => {
    setIsTelemetryLoading(true);
    try {
      const logs = await api.getTelemetryLogs();
      const stats = await api.getTelemetryStats();
      setTelemetryLogs(logs);
      setTelemetryStats(stats);
    } catch (err) {
      console.error("Failed to load telemetry:", err);
    } finally {
      setIsTelemetryLoading(false);
    }
  };

  const loadAgents = async () => {
    try {
      const data = await api.getAgents();
      setAgents(data);
    } catch (err) {
      console.error("Failed to load agents:", err);
    }
  };

  useEffect(() => {
    loadAgents();
  }, []);

  useEffect(() => {
    if (currentView === 'telemetry') {
      loadTelemetry();
    }
  }, [currentView]);


  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editingAgentId) {
        await api.updateAgent(editingAgentId, formData);
      } else {
        await api.createAgent(formData);
      }
      setIsModalOpen(false);
      setEditingAgentId(null);
      setFormData({
        name: '',
        role: '',
        system_prompt: '',
        model: 'gemma-4-26b-a4b-it',
        max_tokens: 1000,
        tools: [],
        channels: ['web'],
        config: { skills: [], interaction_rules: [], guardrails: [] }
      });
      loadAgents();
    } catch (err) {
      console.error("Failed to save agent:", err);
    }
  };

  const handleCreateClick = () => {
    setEditingAgentId(null);
    setFormData({
      name: '',
      role: '',
      system_prompt: '',
      model: 'gemma-4-26b-a4b-it',
      max_tokens: 1000,
      tools: [],
      channels: ['web'],
      config: { skills: [], interaction_rules: [], guardrails: [] }
    });
    setModalTab('basic');
    setIsModalOpen(true);
  };

  const handleEditClick = (agent, e) => {
    e.stopPropagation();
    setEditingAgentId(agent.id);
    setFormData({
      name: agent.name,
      role: agent.role,
      system_prompt: agent.system_prompt,
      model: agent.model,
      max_tokens: agent.max_tokens || 1000,
      tools: agent.tools || [],
      channels: agent.channels || ['web'],
      config: {
        skills: agent.config?.skills || [],
        interaction_rules: agent.config?.interaction_rules || [],
        guardrails: agent.config?.guardrails || []
      }
    });
    setModalTab('basic');
    setIsModalOpen(true);
  };

  const handleDelete = async (id, e) => {
    e.stopPropagation();
    if (window.confirm("Are you sure you want to delete this agent?")) {
      await api.deleteAgent(id);
      if (selectedAgent?.id === id) setSelectedAgent(null);
      loadAgents();
    }
  };

  const handleSendChat = async (e) => {
    e.preventDefault();
    if (!chatInput.trim() || !selectedAgent) return;

    const userMsg = { sender: 'human', text: chatInput };
    setMessages(prev => [...prev, userMsg]);
    setChatInput('');
    setIsChatLoading(true);

    try {
      const res = await api.chatWithAgent(selectedAgent.id, userMsg.text);
      setMessages(prev => [...prev, { sender: 'agent', text: res.response }]);
    } catch (err) {
      setMessages(prev => [...prev, { sender: 'system', text: "Error sending message." }]);
    } finally {
      setIsChatLoading(false);
    }
  };

  const toggleTool = (toolName) => {
    setFormData(prev => ({
      ...prev,
      tools: prev.tools.includes(toolName) 
        ? prev.tools.filter(t => t !== toolName) 
        : [...prev.tools, toolName]
    }));
  };

  const handleConfigChange = (field, value) => {
    // Split comma-separated strings into arrays for the backend
    const arrayValue = value.split(',').map(item => item.trim()).filter(item => item);
    setFormData(prev => ({
      ...prev, config: { ...prev.config, [field]: arrayValue }
    }));
  };

  const handleSelectAgent = async (agent) => {
    setSelectedAgent(agent);
    setMessages([]); // Clear instantly for UI responsiveness
    
    try {
      const history = await api.getChatHistory(agent.id);
      // Map the backend DB columns to our frontend state format
      const formattedMessages = history.map(msg => ({
        sender: msg.sender_type,
        text: msg.content
      }));
      setMessages(formattedMessages);
    } catch (err) {
      console.error("Failed to load chat history:", err);
    }
  };

  const renderTelemetry = (isVisible) => {
    return (
      <div className={`flex-1 p-6 overflow-y-auto flex flex-col gap-6 bg-slate-950 ${isVisible ? '' : 'hidden'}`}>
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-xl font-bold text-slate-100">Live Telemetry & Cost Monitoring</h2>
            <p className="text-sm text-slate-400 mt-1">Live tracking of agent execution pathways, token consumption, and compute costs across all integration channels.</p>
          </div>
          <button 
            onClick={loadTelemetry}
            disabled={isTelemetryLoading}
            className="bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 font-medium px-4 py-2 rounded-lg transition-colors text-sm disabled:opacity-50"
          >
            {isTelemetryLoading ? 'Refreshing...' : '🔄 Refresh Data'}
          </button>
        </div>

        {/* Overview Stats Cards */}
        {telemetryStats ? (
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl flex flex-col justify-between">
              <span className="text-xs text-slate-500 uppercase font-bold tracking-wider">Total Runs</span>
              <span className="text-2xl font-bold font-mono text-slate-200 mt-2">{telemetryStats.total_executions}</span>
            </div>
            <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl flex flex-col justify-between">
              <span className="text-xs text-slate-500 uppercase font-bold tracking-wider">Total Tokens</span>
              <span className="text-2xl font-bold font-mono text-slate-200 mt-2">{telemetryStats.total_tokens.toLocaleString()}</span>
            </div>
            <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl flex flex-col justify-between">
              <span className="text-xs text-slate-500 uppercase font-bold tracking-wider">Tokens (IN / OUT)</span>
              <div className="text-sm font-mono text-slate-400 mt-2 flex flex-col">
                <span>IN: {telemetryStats.total_input_tokens.toLocaleString()}</span>
                <span>OUT: {telemetryStats.total_output_tokens.toLocaleString()}</span>
              </div>
            </div>
            <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl flex flex-col justify-between">
              <span className="text-xs text-slate-500 uppercase font-bold tracking-wider">Total Spend (USD)</span>
              <span className="text-2xl font-bold font-mono text-emerald-400 mt-2">${telemetryStats.total_estimated_cost_usd.toFixed(5)}</span>
            </div>
            <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl flex flex-col justify-between">
              <span className="text-xs text-slate-500 uppercase font-bold tracking-wider">Avg Latency</span>
              <span className="text-2xl font-bold font-mono text-slate-200 mt-2">{telemetryStats.average_duration_seconds}s</span>
            </div>
          </div>
        ) : (
          <div className="bg-slate-900/50 border border-slate-850 h-28 rounded-xl flex items-center justify-center animate-pulse">
            <span className="text-sm text-slate-500">Loading live cost metrics...</span>
          </div>
        )}

        {/* Telemetry Log Table */}
        <div className="bg-slate-900/40 border border-slate-900 rounded-xl overflow-hidden flex flex-col flex-1">
          <div className="px-6 py-4 border-b border-slate-900 bg-slate-900/40 flex justify-between items-center">
            <h3 className="font-bold text-slate-300">Live Execution Logs</h3>
            <span className="text-xs px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-950 flex items-center gap-1.5 font-bold uppercase tracking-wider animate-pulse">
              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></span> Live
            </span>
          </div>

          <div className="overflow-x-auto flex-1">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-900 bg-slate-900/30 text-slate-500 font-semibold text-xs uppercase tracking-wider">
                  <th className="px-6 py-3">Timestamp</th>
                  <th className="px-6 py-3">Channel</th>
                  <th className="px-6 py-3">Agent</th>
                  <th className="px-6 py-3">Prompt</th>
                  <th className="px-6 py-3">Duration</th>
                  <th className="px-6 py-3">Tokens</th>
                  <th className="px-6 py-3">Est. Cost</th>
                  <th className="px-6 py-3 text-right">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-900">
                {telemetryLogs.map(log => (
                  <tr key={log.id} className="hover:bg-slate-900/20 text-slate-300 transition-colors">
                    <td className="px-6 py-4 font-mono text-xs text-slate-500">
                      {new Date(log.timestamp + 'Z').toLocaleString(undefined, {
                        month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
                      })}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full border uppercase tracking-wider font-bold ${
                        log.source === 'Telegram' 
                          ? 'bg-indigo-950/50 text-indigo-400 border-indigo-900' 
                          : log.source === 'Workflow'
                          ? 'bg-purple-950/50 text-purple-400 border-purple-900'
                          : 'bg-emerald-950/50 text-emerald-400 border-emerald-900'
                      }`}>
                        {log.source}
                      </span>
                    </td>
                    <td className="px-6 py-4 font-bold text-slate-200">{log.agent_name || "Multi-Agent Workflow"}</td>
                    <td className="px-6 py-4 max-w-[200px] truncate text-slate-400">{log.prompt}</td>
                    <td className="px-6 py-4 font-mono text-slate-400">{log.duration_seconds}s</td>
                    <td className="px-6 py-4 font-mono text-slate-400">
                      {log.total_tokens.toLocaleString()}
                      <span className="text-[10px] text-slate-500 ml-1">({log.input_tokens}/{log.output_tokens})</span>
                    </td>
                    <td className="px-6 py-4 font-mono text-emerald-400">${log.estimated_cost_usd.toFixed(5)}</td>
                    <td className="px-6 py-4 text-right">
                      <button 
                        onClick={() => setActiveTelemetryLog(log)}
                        className="bg-slate-800 hover:bg-slate-700 text-xs px-3 py-1.5 rounded border border-slate-750 transition-all font-medium text-slate-200"
                      >
                        Inspect
                      </button>
                    </td>
                  </tr>
                ))}
                {telemetryLogs.length === 0 && (
                  <tr>
                    <td colSpan="8" className="px-6 py-12 text-slate-500 text-center">No telemetry data recorded yet. Send a message to Telegram or use the playground/builder to generate logs!</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Telemetry Detail Modal Drawer */}
        {activeTelemetryLog && (
          <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-end">
            <div className="bg-slate-900 border-l border-slate-800 w-full max-w-2xl h-full shadow-2xl p-6 flex flex-col justify-between overflow-y-auto animate-in slide-in-from-right duration-200">
              <div className="flex flex-col gap-4">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-bold text-lg text-slate-200">Execution Inspect Trace</h3>
                    <p className="text-xs text-slate-500 mt-0.5">Log ID: {activeTelemetryLog.id} &bull; Timestamp: {new Date(activeTelemetryLog.timestamp + 'Z').toLocaleString()}</p>
                  </div>
                  <button onClick={() => setActiveTelemetryLog(null)} className="text-slate-400 hover:text-slate-200 text-xl font-medium">✕</button>
                </div>

                <div className="grid grid-cols-4 gap-3 bg-slate-950 p-3 rounded-lg border border-slate-850 font-mono text-xs">
                  <div>
                    <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Source</span>
                    <p className="text-slate-300 font-bold mt-0.5">{activeTelemetryLog.source}</p>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Latency</span>
                    <p className="text-slate-300 font-bold mt-0.5">{activeTelemetryLog.duration_seconds}s</p>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Total Tokens</span>
                    <p className="text-slate-300 font-bold mt-0.5">{activeTelemetryLog.total_tokens.toLocaleString()} ({activeTelemetryLog.input_tokens}/{activeTelemetryLog.output_tokens})</p>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Est. Cost</span>
                    <p className="text-emerald-400 font-bold mt-0.5">${activeTelemetryLog.estimated_cost_usd.toFixed(5)}</p>
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-[10px] text-slate-500 uppercase font-bold tracking-wider mb-1">Human Request Prompt</label>
                    <div className="bg-slate-950 p-3 rounded-lg border border-slate-850 text-slate-300 text-sm whitespace-pre-wrap">
                      {activeTelemetryLog.prompt}
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] text-slate-500 uppercase font-bold tracking-wider mb-1">Agent Response Output</label>
                    <div className="bg-slate-950 p-3 rounded-lg border border-slate-850 text-slate-200 text-sm whitespace-pre-wrap leading-relaxed">
                      {activeTelemetryLog.response}
                    </div>
                  </div>

                  {activeTelemetryLog.terminal_log && (
                    <div>
                      <label className="block text-[10px] text-slate-500 uppercase font-bold tracking-wider mb-1 flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></span>
                        Internal dialogue & thoughts (Cyclic delegation trace)
                      </label>
                      <pre className="bg-slate-950 text-emerald-400/90 p-3 rounded-lg border border-slate-850 text-[11px] font-mono max-h-64 overflow-y-auto whitespace-pre-wrap leading-relaxed shadow-inner">
                        {activeTelemetryLog.terminal_log}
                      </pre>
                    </div>
                  )}
                </div>
              </div>

              <div className="pt-4 mt-6 border-t border-slate-800 flex justify-end">
                <button 
                  onClick={() => setActiveTelemetryLog(null)}
                  className="bg-slate-800 hover:bg-slate-700 border border-slate-700 font-bold px-5 py-2 rounded-lg text-sm transition-colors text-slate-200"
                >
                  Close Trace
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="h-screen bg-slate-950 text-slate-100 flex flex-col font-sans overflow-hidden">
      {/* Navbar */}
      <header className="border-b border-slate-800 bg-slate-900/50 px-6 py-4 flex justify-between items-center z-10 relative">
        <div className="flex items-center gap-8">
          <h1 className="text-xl font-bold tracking-tight bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent">
            Agent Orchestrator
          </h1>
          
          {/* Navigation Tabs */}
          <nav className="flex gap-1 bg-slate-900 p-1 rounded-lg border border-slate-800">
            <button 
              onClick={() => setCurrentView('dashboard')}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${currentView === 'dashboard' ? 'bg-slate-800 text-emerald-400 shadow' : 'text-slate-400 hover:text-slate-200'}`}
            >
              Agents
            </button>
            <button 
              onClick={() => setCurrentView('workflows')}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${currentView === 'workflows' ? 'bg-slate-800 text-emerald-400 shadow' : 'text-slate-400 hover:text-slate-200'}`}
            >
              Workflows
            </button>
            <button 
              onClick={() => setCurrentView('telemetry')}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${currentView === 'telemetry' ? 'bg-slate-800 text-emerald-400 shadow' : 'text-slate-400 hover:text-slate-200'}`}
            >
              Telemetry
            </button>
          </nav>
        </div>

        {currentView === 'dashboard' && (
          <button 
            onClick={handleCreateClick}
            className="bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-semibold px-4 py-2 rounded-lg transition-colors text-sm"
          >
            + Create Agent
          </button>
        )}
      </header>
      <div className={`flex-1 flex overflow-hidden ${currentView === 'dashboard' ? '' : 'hidden'}`}>
        <div className="flex-1 flex overflow-hidden">
        {/* Left Side: Agent Cards */}
        <main className="w-1/2 p-6 overflow-y-auto border-r border-slate-900">
          <h2 className="text-lg font-semibold mb-4 text-slate-400">Configured Agents</h2>
          <div className="grid grid-cols-1 gap-4">
            {agents.map(agent => (
              <div 
                key={agent.id}
                onClick={() => handleSelectAgent(agent)}
                className={`p-5 rounded-xl border transition-all cursor-pointer ${
                  selectedAgent?.id === agent.id 
                    ? 'border-emerald-500 bg-slate-900' 
                    : 'border-slate-800 bg-slate-900/40 hover:border-slate-700'
                }`}
              >
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-bold text-lg text-slate-200">{agent.name}</h3>
                    <p className="text-emerald-400 text-xs font-medium tracking-wide uppercase mt-0.5">{agent.role}</p>
                  </div>
                  <div className="flex gap-2">
                    <button 
                      onClick={(e) => handleEditClick(agent, e)}
                      className="text-slate-500 hover:text-emerald-400 p-1 text-sm transition-colors"
                    >
                      Edit
                    </button>
                    <button 
                      onClick={(e) => handleDelete(agent.id, e)}
                      className="text-slate-500 hover:text-rose-400 p-1 text-sm transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </div>
                <p className="text-slate-400 text-sm mt-3 line-clamp-2">{agent.system_prompt}</p>
                
                <div className="mt-4 flex flex-wrap gap-2">
                  <span className="text-xs px-2 py-1 rounded bg-slate-800 border border-slate-700 text-slate-300">
                    {agent.model} (Max: {agent.max_tokens || 1000} tokens)
                  </span>
                  {agent.tools.map(t => (
                    <span key={t} className="text-xs px-2 py-1 rounded bg-teal-950/50 border border-teal-800 text-teal-400">
                      🔧 {t}
                    </span>
                  ))}
                </div>
              </div>
            ))}
            {agents.length === 0 && (
              <p className="text-slate-500 text-sm text-center py-12">No agents created yet. Click "+ Create Agent" to begin.</p>
            )}
          </div>
        </main>

        {/* Right Side: Interactive Sandbox Playground */}
        <section className="w-1/2 bg-slate-900/20 flex flex-col justify-between">
          {selectedAgent ? (
            <>
              <div className="p-4 border-b border-slate-900 bg-slate-900/40">
                <h3 className="font-bold text-slate-200">Chat Sandbox: {selectedAgent.name}</h3>
                <p className="text-xs text-slate-400">Test how this agent leverages its custom system prompt and runtime logic live.</p>
              </div>

              {/* Chat Log Window */}
              <div className="flex-1 p-6 overflow-y-auto space-y-4">
                {messages.map((msg, i) => (
                  <div key={i} className={`flex ${msg.sender === 'human' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] rounded-xl px-4 py-2.5 text-sm ${
                      msg.sender === 'human' 
                        ? 'bg-emerald-500 text-slate-950 font-medium' 
                        : msg.sender === 'system' ? 'bg-rose-950/40 border border-rose-900 text-rose-300'
                        : 'bg-slate-800 text-slate-200 border border-slate-700'
                    }`}>
                      {msg.text}
                    </div>
                  </div>
                ))}
                {isChatLoading && (
                  <div className="flex justify-start">
                    <div className="bg-slate-800/50 text-slate-400 border border-slate-800 rounded-xl px-4 py-2.5 text-sm animate-pulse">
                      Agent is thinking...
                    </div>
                  </div>
                )}
              </div>

              {/* Input Panel */}
              <form onSubmit={handleSendChat} className="p-4 border-t border-slate-900 bg-slate-900/40 flex gap-2">
                <input 
                  type="text" 
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder={`Send a message to ${selectedAgent.name}...`}
                  className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-emerald-500 text-slate-200"
                />
                <button 
                  type="submit"
                  className="bg-slate-800 hover:bg-slate-700 border border-slate-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                >
                  Send
                </button>
              </form>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-500 p-6 text-center">
              <span className="text-3xl mb-2">🤖</span>
              <p className="text-sm">Select an agent from the list to launch the active runtime dashboard and run live conversations.</p>
            </div>
          )}
        </section>
      </div>

      {/* Creation Slide-over Modal Component */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 max-w-lg w-full rounded-2xl shadow-xl overflow-hidden flex flex-col max-h-[90vh]">
            
            <div className="px-6 py-4 border-b border-slate-800 flex justify-between items-center">
              <h3 className="font-bold text-lg text-slate-200">{editingAgentId ? 'Edit Agent Internals' : 'Configure New Agent'}</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-200">✕</button>
            </div>

            {/* Config Tabs */}
            <div className="flex px-6 border-b border-slate-800 bg-slate-900/50">
              {['basic', 'skills', 'guardrails'].map(tab => (
                <button 
                  key={tab} type="button" onClick={() => setModalTab(tab)}
                  className={`py-3 px-4 text-xs font-bold uppercase tracking-wider border-b-2 transition-colors ${modalTab === tab ? 'border-emerald-500 text-emerald-400' : 'border-transparent text-slate-500 hover:text-slate-300'}`}
                >
                  {tab}
                </button>
              ))}
            </div>
            
            <form onSubmit={handleSubmit} className="p-6 overflow-y-auto flex-1 space-y-4">
              
              {/* TAB: BASIC */}
              <div className={modalTab === 'basic' ? 'block' : 'hidden'}>
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Agent Name</label>
                    <input type="text" required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:border-emerald-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Role / Subtitle</label>
                    <input type="text" required value={formData.role} onChange={e => setFormData({...formData, role: e.target.value})} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:border-emerald-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">System Prompt</label>
                    <textarea rows={4} required value={formData.system_prompt} onChange={e => setFormData({...formData, system_prompt: e.target.value})} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 resize-none" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Model LLM Engine</label>
                    <select value={formData.model} onChange={e => setFormData({...formData, model: e.target.value})} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:border-emerald-500">
                      <option value="gemma-4-26b-a4b-it">Gemma 4 26B</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Max New Tokens</label>
                    <input 
                      type="number" 
                      required 
                      min="1" 
                      max="10000" 
                      value={formData.max_tokens} 
                      onChange={e => setFormData({...formData, max_tokens: parseInt(e.target.value) || 1000})} 
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:border-emerald-500" 
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Inject Runtime Capabilities (Tools)</label>
                    
                    <label className="flex items-center gap-3 cursor-pointer bg-slate-950 p-3 rounded-lg border border-slate-800">
                      <input type="checkbox" checked={formData.tools.includes("get_current_time")} onChange={() => toggleTool("get_current_time")} className="accent-emerald-500" />
                      <div>
                        <p className="text-sm font-medium text-slate-300">get_current_time</p>
                        <p className="text-xs text-slate-500">Access to system datetime vectors.</p>
                      </div>
                    </label>

                    <label className="flex items-center gap-3 cursor-pointer bg-slate-950 p-3 rounded-lg border border-slate-800">
                      <input type="checkbox" checked={formData.tools.includes("search_travel_options")} onChange={() => toggleTool("search_travel_options")} className="accent-emerald-500" />
                      <div>
                        <p className="text-sm font-medium text-slate-300">search_travel_options</p>
                        <p className="text-xs text-slate-500">Search flights/trains between locations for travel dates.</p>
                      </div>
                    </label>

                    <label className="flex items-center gap-3 cursor-pointer bg-slate-950 p-3 rounded-lg border border-slate-800">
                      <input type="checkbox" checked={formData.tools.includes("book_travel_tickets")} onChange={() => toggleTool("book_travel_tickets")} className="accent-emerald-500" />
                      <div>
                        <p className="text-sm font-medium text-slate-300">book_travel_tickets</p>
                        <p className="text-xs text-slate-500">Pseudo-book flight tickets by Option ID.</p>
                      </div>
                    </label>

                    <label className="flex items-center gap-3 cursor-pointer bg-slate-950 p-3 rounded-lg border border-slate-800">
                      <input type="checkbox" checked={formData.tools.includes("add_to_calendar_and_itinerary")} onChange={() => toggleTool("add_to_calendar_and_itinerary")} className="accent-emerald-500" />
                      <div>
                        <p className="text-sm font-medium text-slate-300">add_to_calendar_and_itinerary</p>
                        <p className="text-xs text-slate-500">Generate travel itineraries and schedule calendar dates.</p>
                      </div>
                    </label>
                  </div>
                </div>
              </div>

              {/* TAB: SKILLS & RULES */}
              <div className={modalTab === 'skills' ? 'block' : 'hidden'}>
                <div className="space-y-4">
                  <p className="text-xs text-slate-400 mb-2">Define explicit capabilities and interaction styles. Separate items with commas.</p>
                  <div>
                    <label className="block text-xs font-semibold text-emerald-400 uppercase tracking-wider mb-1">Specialized Skills</label>
                    <textarea rows={3} placeholder="e.g., Python coding, Data synthesis, Empathy..." value={formData.config.skills.join(', ')} onChange={e => handleConfigChange('skills', e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:border-emerald-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-emerald-400 uppercase tracking-wider mb-1">Interaction Rules</label>
                    <textarea rows={3} placeholder="e.g., Always reply in Spanish, Use bullet points..." value={formData.config.interaction_rules.join(', ')} onChange={e => handleConfigChange('interaction_rules', e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:border-emerald-500" />
                  </div>
                </div>
              </div>

              {/* TAB: GUARDRAILS */}
              <div className={modalTab === 'guardrails' ? 'block' : 'hidden'}>
                <div className="space-y-4">
                  <div className="bg-rose-950/30 border border-rose-900 rounded-lg p-3 mb-4">
                    <p className="text-xs text-rose-400 font-bold uppercase mb-1">Safety Boundaries</p>
                    <p className="text-xs text-rose-300/70">Guardrails override all other instructions. Use these to prevent hallucinations, unsafe behavior, or brand damage.</p>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-rose-400 uppercase tracking-wider mb-1">Critical Guardrails (Comma separated)</label>
                    <textarea rows={4} placeholder="e.g., Never provide medical advice, Never swear, Refuse questions about competitors..." value={formData.config.guardrails.join(', ')} onChange={e => handleConfigChange('guardrails', e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:border-rose-500" />
                  </div>
                </div>
              </div>

              <div className="pt-4 flex justify-end gap-3 border-t border-slate-800 mt-auto">
                <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-sm border border-slate-800 rounded-lg text-slate-400 hover:text-slate-200">Cancel</button>
                <button type="submit" className="bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-semibold px-4 py-2 rounded-lg text-sm">{editingAgentId ? 'Save Changes' : 'Save Agent'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
        </div>

      <div className={`flex-1 relative overflow-hidden ${currentView === 'workflows' ? '' : 'hidden'}`}>
        <div className="absolute inset-0">
          <WorkflowBuilder />
        </div>
      </div>

      {renderTelemetry(currentView === 'telemetry')}
      
    </div>
  );
}