import { useState, useEffect, useCallback, useRef } from 'react';
import ReactFlow, { Background, Controls, MiniMap, applyNodeChanges, applyEdgeChanges, addEdge } from 'reactflow';
import 'reactflow/dist/style.css';
import { api } from './api';
import AgentNode from './AgentNode';

const nodeTypes = { agentNode: AgentNode };

export default function WorkflowBuilder() {
  const reactFlowWrapper = useRef(null);
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [availableAgents, setAvailableAgents] = useState([]);
  const [reactFlowInstance, setReactFlowInstance] = useState(null);
  
  // Custom Workflows state
  const [savedWorkflows, setSavedWorkflows] = useState([]);
  const [workflowName, setWorkflowName] = useState('');
  const [workflowDescription, setWorkflowDescription] = useState('');
  const [currentWorkflowId, setCurrentWorkflowId] = useState(null);
  const [sidebarTab, setSidebarTab] = useState('palette'); // 'palette', 'configure', 'saved'
  const selectedNode = nodes.find(n => n.selected);

  // Test Panel State
  const [testInput, setTestInput] = useState('');
  const [testResults, setTestResults] = useState(null);
  const [isRunning, setIsRunning] = useState(false);
  const [workflowThreadId, setWorkflowThreadId] = useState(null);
  const [isPaused, setIsPaused] = useState(false);
  const [pausedAgentName, setPausedAgentName] = useState('');

  const fetchWorkflows = useCallback(async () => {
    try {
      const data = await api.listWorkflows();
      setSavedWorkflows(data);
    } catch (err) {
      console.error("Failed to fetch workflows:", err);
    }
  }, []);

  useEffect(() => {
    api.getAgents().then(setAvailableAgents).catch(console.error);
    fetchWorkflows();
  }, [fetchWorkflows]);

  const onNodesChange = useCallback((changes) => setNodes((nds) => applyNodeChanges(changes, nds)), []);
  const onEdgesChange = useCallback((changes) => setEdges((eds) => applyEdgeChanges(changes, eds)), []);
  const onConnect = useCallback((params) => setEdges((eds) => addEdge({ ...params, animated: true, style: { stroke: '#10b981', strokeWidth: 2 } }, eds)), []);

  const onDragStart = (event, agent) => {
    event.dataTransfer.setData('application/reactflow', JSON.stringify(agent));
    event.dataTransfer.effectAllowed = 'move';
  };

  const onDragOver = useCallback((event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback((event) => {
    event.preventDefault();
    const agentDataString = event.dataTransfer.getData('application/reactflow');
    if (!agentDataString || !reactFlowInstance) return;
    
    const agent = JSON.parse(agentDataString);
    const position = reactFlowInstance.screenToFlowPosition({
      x: event.clientX,
      y: event.clientY,
    });

    const newNode = {
      id: `agent_${agent.id}_${Date.now()}`,
      type: 'agentNode',
      position,
      data: { label: agent.name, role: agent.role, model: agent.model, dbId: agent.id },
    };

    setNodes((nds) => nds.concat(newNode));
  }, [reactFlowInstance, setNodes]);

  // Execute Workflow Logic
  const handleRunWorkflow = async () => {
    if (nodes.length === 0) return alert("Add some agents to the canvas first!");
    if (isRunning) return;

    let activeThreadId = workflowThreadId;
    if (!isPaused || !activeThreadId) {
      activeThreadId = 'web_wf_' + Date.now();
      setWorkflowThreadId(activeThreadId);
      setTestResults({
        final_result: '',
        steps: [],
        terminal_log: '',
        telemetry: null
      });
    }

    setIsRunning(true);
    const currentInput = testInput || "Begin task.";
    setTestInput(''); // Clear input for user convenience

    const payload = {
      nodes: nodes.map(n => ({ 
        id: n.id, 
        db_id: n.data.dbId,
        label: n.data.label,
        role: n.data.role,
        requireConfirmation: n.data.requireConfirmation || false
      })),
      edges: edges.map(e => ({ 
        source: e.source, 
        target: e.target 
      })),
      message: currentInput,
      thread_id: activeThreadId
    };

    try {
      const response = await fetch('http://127.0.0.1:8000/agents/workflow/execute/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.body) {
        throw new Error("ReadableStream not supported or no body returned.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let streamPaused = false;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Save remaining incomplete line

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data: ')) {
            try {
              const item = JSON.parse(trimmed.slice(6));
              if (item.event === 'agent_start') {
                setPausedAgentName(item.data.agent_name);
              } else if (item.event === 'agent_output') {
                const step = item.data;
                setTestResults(prev => {
                  const existingSteps = prev?.steps || [];
                  const exists = existingSteps.some(s => s.agent_name === step.agent_name && s.output_generated === step.output_generated);
                  if (exists) return prev;
                  return {
                    ...prev,
                    steps: [...existingSteps, step]
                  };
                });
              } else if (item.event === 'paused') {
                setIsPaused(true);
                setPausedAgentName(item.data.agent_name);
                streamPaused = true;
              } else if (item.event === 'final_result') {
                setTestResults(prev => ({
                  ...prev,
                  telemetry: item.data.telemetry,
                  terminal_log: item.data.terminal_log,
                  final_result: item.data.final_result
                }));
              } else if (item.event === 'error') {
                alert(`Workflow failed: ${item.data}`);
              }
            } catch (err) {
              console.error("Failed to parse event stream message:", err);
            }
          }
        }
      }

      if (!streamPaused) {
        setIsPaused(false);
        setWorkflowThreadId(null);
      }
    } catch (error) {
      console.error("Workflow failed", error);
      alert("Workflow execution failed. Check console.");
    } finally {
      setIsRunning(false);
    }
  };

  const handleResetWorkflowRun = () => {
    setWorkflowThreadId(null);
    setIsPaused(false);
    setPausedAgentName('');
    setTestInput('');
    setTestResults(null);
  };

  // Custom Workflows Management Handlers
  const handleSaveWorkflow = async () => {
    if (!workflowName.trim()) {
      alert("Please provide a name for the workflow!");
      return;
    }
    if (nodes.length === 0) {
      alert("Add some agents to the canvas first!");
      return;
    }

    const payload = {
      name: workflowName,
      description: workflowDescription,
      nodes: nodes.map(n => ({
        id: n.id,
        type: n.type,
        position: n.position,
        data: n.data
      })),
      edges: edges.map(e => ({
        id: e.id,
        source: e.source,
        target: e.target,
        animated: e.animated,
        style: e.style
      })),
      is_active_telegram: false
    };

    try {
      const saved = await api.saveWorkflow(payload);
      alert(`Workflow "${saved.name}" saved successfully!`);
      setCurrentWorkflowId(saved.id);
      fetchWorkflows();
    } catch (err) {
      console.error("Failed to save workflow:", err);
      alert("Failed to save workflow. Names must be unique.");
    }
  };

  const handleLoadWorkflow = (wf) => {
    setNodes(wf.nodes || []);
    setEdges(wf.edges || []);
    setWorkflowName(wf.name || '');
    setWorkflowDescription(wf.description || '');
    setCurrentWorkflowId(wf.id);
    
    // Fit view after React Flow state aligns
    setTimeout(() => {
      if (reactFlowInstance) {
        reactFlowInstance.fitView();
      }
    }, 100);
  };

  const handleDeleteWorkflow = async (wfId, e) => {
    e.stopPropagation();
    if (!window.confirm("Are you sure you want to delete this custom workflow?")) return;
    try {
      await api.deleteWorkflow(wfId);
      if (currentWorkflowId === wfId) {
        handleClearCanvas();
      }
      fetchWorkflows();
    } catch (err) {
      console.error("Failed to delete workflow:", err);
      alert("Failed to delete workflow.");
    }
  };

  const handleActivateTelegram = async (wfId, e) => {
    e.stopPropagation();
    try {
      await api.activateTelegramWorkflow(wfId);
      alert("This workflow is now active for handling Telegram bot messages!");
      fetchWorkflows();
    } catch (err) {
      console.error("Failed to activate workflow:", err);
      alert("Failed to activate workflow.");
    }
  };

  const handleDeactivateTelegram = async (e) => {
    e.stopPropagation();
    try {
      await api.deactivateTelegramWorkflows();
      alert("Telegram bot reverted to default Single-Agent mode.");
      fetchWorkflows();
    } catch (err) {
      console.error("Failed to deactivate workflows:", err);
      alert("Failed to deactivate workflows.");
    }
  };

  const handleSaveAndActivateTelegram = async (e) => {
    if (e) e.stopPropagation();
    
    // Fallback name if none set
    let activeName = workflowName.trim();
    if (!activeName) {
      activeName = prompt("Please enter a name for this Telegram workflow:", "My Custom Telegram Workflow");
      if (!activeName) return;
      setWorkflowName(activeName);
    }
    
    if (nodes.length === 0) {
      alert("Add some agents to the canvas first!");
      return;
    }

    const payload = {
      name: activeName,
      description: workflowDescription || "Created via Route Telegram to Canvas Workflow quick action",
      nodes: nodes.map(n => ({
        id: n.id,
        type: n.type,
        position: n.position,
        data: n.data
      })),
      edges: edges.map(e => ({
        id: e.id,
        source: e.source,
        target: e.target,
        animated: e.animated,
        style: e.style
      })),
      is_active_telegram: false
    };

    try {
      const saved = await api.saveWorkflow(payload);
      setCurrentWorkflowId(saved.id);
      
      // Activate on Telegram
      await api.activateTelegramWorkflow(saved.id);
      alert(`Workflow "${activeName}" is now active on Telegram! Any message sent to the Telegram bot will route through this workflow.`);
      fetchWorkflows();
    } catch (err) {
      console.error("Failed to save/activate Telegram workflow:", err);
      alert("Failed to save/activate workflow. Please check console.");
    }
  };

  const handleClearCanvas = () => {
    setNodes([]);
    setEdges([]);
    setWorkflowName('');
    setWorkflowDescription('');
    setCurrentWorkflowId(null);
  };

  const loadTemplate = async (templateName) => {
    let latestAgents = availableAgents;
    try {
      latestAgents = await api.getAgents();
      setAvailableAgents(latestAgents);
    } catch (err) {
      console.error("Failed to refresh agents:", err);
    }

    const travelSearcher = latestAgents.find(a => a.name === "TravelSearcher");
    const travelManager = latestAgents.find(a => a.name === "TravelManager");
    const ticketBooker = latestAgents.find(a => a.name === "TicketBooker");
    const itineraryScheduler = latestAgents.find(a => a.name === "ItineraryScheduler");
    const telegramFormatter = latestAgents.find(a => a.name === "TelegramFormatter");
    const googleCalendarIntegrator = latestAgents.find(a => a.name === "GoogleCalendarIntegrator");

    if (templateName === "travel_concierge_hub_spoke") {
      if (!travelSearcher || !travelManager || !ticketBooker || !itineraryScheduler || !googleCalendarIntegrator || !telegramFormatter) {
        alert("Pre-configured agents not found in DB. Please make sure TravelManager and the other specialists are seeded or created!");
        return;
      }
      const searchId = `agent_${travelSearcher.id}_${Date.now()}_1`;
      const managerId = `agent_${travelManager.id}_${Date.now()}_manager`;
      const bookId = `agent_${ticketBooker.id}_${Date.now()}_2`;
      const scheduleId = `agent_${itineraryScheduler.id}_${Date.now()}_3`;
      const calId = `agent_${googleCalendarIntegrator.id}_${Date.now()}_4`;
      const formatId = `agent_${telegramFormatter.id}_${Date.now()}_5`;

      const newNodes = [
        {
          id: searchId,
          type: 'agentNode',
          position: { x: 200, y: 300 },
          data: { label: travelSearcher.name, role: travelSearcher.role, goal: "Search and retrieve the best travel and flight options for the user destination and origin.", model: travelSearcher.model, dbId: travelSearcher.id, requireConfirmation: false },
        },
        {
          id: managerId,
          type: 'agentNode',
          position: { x: 500, y: 300 },
          data: { label: travelManager.name, role: travelManager.role, goal: "Deliver a complete, final travel itinerary with all details, ensuring tickets are booked, calendar planning is completed, calendar invites are generated, and a formatted telegram-ready itinerary is delivered automatically without requiring manual step-by-step requests from the user.", model: travelManager.model, dbId: travelManager.id, requireConfirmation: true },
        },
        {
          id: bookId,
          type: 'agentNode',
          position: { x: 350, y: 100 },
          data: { label: ticketBooker.name, role: ticketBooker.role, goal: "Book flight tickets and return confirmation references.", model: ticketBooker.model, dbId: ticketBooker.id, requireConfirmation: false },
        },
        {
          id: scheduleId,
          type: 'agentNode',
          position: { x: 650, y: 100 },
          data: { label: itineraryScheduler.name, role: itineraryScheduler.role, goal: "Schedule the itinerary details on the calendar and outline the day-by-day travel plan.", model: itineraryScheduler.model, dbId: itineraryScheduler.id, requireConfirmation: false },
        },
        {
          id: calId,
          type: 'agentNode',
          position: { x: 650, y: 500 },
          data: { label: googleCalendarIntegrator.name, role: googleCalendarIntegrator.role, goal: "Create google calendar events and retrieve save URLs.", model: googleCalendarIntegrator.model, dbId: googleCalendarIntegrator.id, requireConfirmation: false },
        },
        {
          id: formatId,
          type: 'agentNode',
          position: { x: 350, y: 500 },
          data: { label: telegramFormatter.name, role: telegramFormatter.role, goal: "Produce a polished, emoji-rich, telegram-ready summary of the final booked itinerary and calendar link with clear formatting, and no literal \\n characters.", model: telegramFormatter.model, dbId: telegramFormatter.id, requireConfirmation: false },
        }
      ];

      const newEdges = [
        { id: `e_${searchId}_${managerId}`, source: searchId, target: managerId, animated: true, style: { stroke: '#10b981', strokeWidth: 2 } },
        { id: `e_${managerId}_${bookId}`, source: managerId, target: bookId, animated: true, style: { stroke: '#10b981', strokeWidth: 2 } },
        { id: `e_${managerId}_${scheduleId}`, source: managerId, target: scheduleId, animated: true, style: { stroke: '#10b981', strokeWidth: 2 } },
        { id: `e_${managerId}_${calId}`, source: managerId, target: calId, animated: true, style: { stroke: '#10b981', strokeWidth: 2 } },
        { id: `e_${managerId}_${formatId}`, source: managerId, target: formatId, animated: true, style: { stroke: '#10b981', strokeWidth: 2 } }
      ];

      setNodes(newNodes);
      setEdges(newEdges);
      setWorkflowName("Travel Concierge Workflow");
      setWorkflowDescription("Seeded Travel Concierge Workflow template designed as a hub-spoke manager-worker configuration.");
      setCurrentWorkflowId(null);
    } else if (templateName === "interview_scheduling") {
      const recManager = latestAgents.find(a => a.name === "RecruitmentManager");
      const recSourcer = latestAgents.find(a => a.name === "CandidateSlotSourcer");
      const recBooker = latestAgents.find(a => a.name === "InterviewSlotBooker");
      const recPlanner = latestAgents.find(a => a.name === "InterviewAgendaPlanner");
      const recInviter = latestAgents.find(a => a.name === "CalendarInviter");
      const recCoordinator = latestAgents.find(a => a.name === "RecruitmentCoordinator");

      const manager = recManager || travelManager;
      const sourcer = recSourcer || travelSearcher;
      const booker = recBooker || ticketBooker;
      const planner = recPlanner || itineraryScheduler;
      const inviter = recInviter || googleCalendarIntegrator;
      const coordinator = recCoordinator || telegramFormatter;

      if (!manager || !sourcer || !booker || !planner || !inviter || !coordinator) {
        alert("Pre-configured agents not found in DB. Please make sure Recruitment or Travel specialists are seeded or created!");
        return;
      }
      const sourcerId = `agent_${sourcer.id}_${Date.now()}_1`;
      const managerId = `agent_${manager.id}_${Date.now()}_manager`;
      const bookerId = `agent_${booker.id}_${Date.now()}_2`;
      const plannerId = `agent_${planner.id}_${Date.now()}_3`;
      const inviterId = `agent_${inviter.id}_${Date.now()}_4`;
      const coordinatorId = `agent_${coordinator.id}_${Date.now()}_5`;

      const newNodes = [
        {
          id: sourcerId,
          type: 'agentNode',
          position: { x: 200, y: 300 },
          data: { label: sourcer.name, role: sourcer.role, goal: sourcer.goal || "Source candidate slots and negotiation inputs.", model: sourcer.model, dbId: sourcer.id, requireConfirmation: false },
        },
        {
          id: managerId,
          type: 'agentNode',
          position: { x: 500, y: 300 },
          data: { label: manager.name, role: manager.role, goal: manager.goal || "Deliver a complete, final interview schedule with prep agenda, ensuring slots are booked, calendar invites are sent, and a formatted coordinator confirmation is delivered without forcing manual step-by-step guidance.", model: manager.model, dbId: manager.id, requireConfirmation: true },
        },
        {
          id: bookerId,
          type: 'agentNode',
          position: { x: 350, y: 100 },
          data: { label: booker.name, role: booker.role, goal: booker.goal || "Book interview slot confirmations.", model: booker.model, dbId: booker.id, requireConfirmation: false },
        },
        {
          id: plannerId,
          type: 'agentNode',
          position: { x: 650, y: 100 },
          data: { label: planner.name, role: planner.role, goal: planner.goal || "Create detailed prep agenda and study plan for the interview.", model: planner.model, dbId: planner.id, requireConfirmation: false },
        },
        {
          id: inviterId,
          type: 'agentNode',
          position: { x: 650, y: 500 },
          data: { label: inviter.name, role: inviter.role, goal: inviter.goal || "Send google calendar invites and links to candidates.", model: inviter.model, dbId: inviter.id, requireConfirmation: false },
        },
        {
          id: coordinatorId,
          type: 'agentNode',
          position: { x: 350, y: 500 },
          data: { label: coordinator.name, role: coordinator.role, goal: coordinator.goal || "Format a polished recruitment telegram message with details and calendar links, without outputting literal \\n.", model: coordinator.model, dbId: coordinator.id, requireConfirmation: false },
        }
      ];

      const newEdges = [
        { id: `e_${sourcerId}_${managerId}`, source: sourcerId, target: managerId, animated: true, style: { stroke: '#10b981', strokeWidth: 2 } },
        { id: `e_${managerId}_${bookerId}`, source: managerId, target: bookerId, animated: true, style: { stroke: '#10b981', strokeWidth: 2 } },
        { id: `e_${managerId}_${plannerId}`, source: managerId, target: plannerId, animated: true, style: { stroke: '#10b981', strokeWidth: 2 } },
        { id: `e_${managerId}_${inviterId}`, source: managerId, target: inviterId, animated: true, style: { stroke: '#10b981', strokeWidth: 2 } },
        { id: `e_${managerId}_${coordinatorId}`, source: managerId, target: coordinatorId, animated: true, style: { stroke: '#10b981', strokeWidth: 2 } }
      ];

      setNodes(newNodes);
      setEdges(newEdges);
      setWorkflowName("Interview Scheduling Pipeline");
      setWorkflowDescription("Recruitment workflow designed in a manager-worker hub-spoke topology for interview scheduling.");
      setCurrentWorkflowId(null);
    }
  };

  return (
    <div className="flex h-full w-full bg-slate-950 relative">
      <aside className="w-80 border-r border-slate-800 bg-slate-900/50 p-4 flex flex-col z-10 select-none">
        
        {/* Telegram Bot Handler Status */}
        <div className="mb-4 bg-slate-950/80 p-3 rounded-lg border border-slate-800 text-xs shadow-inner">
          <p className="text-slate-400 font-bold mb-1.5 uppercase tracking-wider text-[10px]">Telegram Bot Channel Status</p>
          {savedWorkflows.some(wf => wf.is_active_telegram) ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 text-emerald-400">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                <span className="font-medium truncate">
                  Active: <strong className="text-emerald-300">{savedWorkflows.find(wf => wf.is_active_telegram).name}</strong>
                </span>
              </div>
              <button
                onClick={handleDeactivateTelegram}
                className="w-full text-center py-1 bg-amber-950/20 hover:bg-amber-950/40 border border-amber-900/50 text-[10px] font-semibold text-amber-400 rounded transition-colors"
              >
                Revert Bot to Single-Agent Chat
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-amber-400 font-medium">
              <span className="h-2 w-2 rounded-full bg-amber-500"></span>
              <span>Reverted to Single-Agent fallback mode</span>
            </div>
          )}
          {nodes.length > 0 && (
            <button
              onClick={handleSaveAndActivateTelegram}
              className="w-full text-center py-1.5 mt-2.5 bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 border border-emerald-400/20 text-[10px] font-bold text-slate-950 rounded transition-all shadow flex items-center justify-center gap-1"
            >
              ⚡ Route Telegram to Canvas Workflow
            </button>
          )}
        </div>

        {/* Sidebar Tabs */}
        <div className="flex border-b border-slate-800 mb-4 text-xs">
          <button
            onClick={() => setSidebarTab('palette')}
            className={`flex-1 pb-2 text-center font-bold uppercase tracking-wider transition-colors ${
              sidebarTab === 'palette' ? 'text-emerald-400 border-b-2 border-emerald-500' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            🧩 Palette
          </button>
          <button
            onClick={() => setSidebarTab('configure')}
            className={`flex-1 pb-2 text-center font-bold uppercase tracking-wider transition-colors ${
              sidebarTab === 'configure' ? 'text-emerald-400 border-b-2 border-emerald-500' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            ⚙️ Config
          </button>
          <button
            onClick={() => setSidebarTab('saved')}
            className={`flex-1 pb-2 text-center font-bold uppercase tracking-wider transition-colors ${
              sidebarTab === 'saved' ? 'text-emerald-400 border-b-2 border-emerald-500' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            📁 Saved ({savedWorkflows.length})
          </button>
        </div>

        {/* Tab Contents */}
        {sidebarTab === 'palette' && (
          <div className="flex-1 overflow-y-auto flex flex-col">


            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2.5">Templates</h2>
            <div className="space-y-2 mb-4">
              <button 
                onClick={() => loadTemplate("travel_concierge_hub_spoke")}
                className="w-full text-left p-2.5 bg-indigo-950/20 hover:bg-indigo-950/40 border border-indigo-900/50 rounded-lg text-xs font-semibold text-indigo-400 transition-colors"
              >
                📋 Travel Concierge Workflow (Hub-Spoke)
              </button>
              <button 
                onClick={() => loadTemplate("interview_scheduling")}
                className="w-full text-left p-2.5 bg-emerald-950/20 hover:bg-emerald-950/40 border border-emerald-900/50 rounded-lg text-xs font-semibold text-emerald-400 transition-colors"
              >
                📋 Interview Scheduling Pipeline (Hub-Spoke)
              </button>
            </div>


            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2.5 border-t border-slate-800 pt-3">Agents</h2>
            <div className="flex-1 overflow-y-auto space-y-3 pr-1">
              {availableAgents.map((agent) => (
                <div 
                  key={agent.id} draggable onDragStart={(e) => onDragStart(e, agent)}
                  className="p-3 bg-slate-800/80 border border-slate-700/60 rounded-lg cursor-grab active:cursor-grabbing hover:border-emerald-500 transition-all shadow-sm"
                >
                  <h3 className="text-sm font-bold text-slate-200">{agent.name}</h3>
                  <p className="text-xs text-slate-400 truncate">{agent.role}</p>
                  <div className="mt-2 flex items-center justify-between text-[9px]">
                    <span className="px-1.5 py-0.5 bg-slate-900 border border-slate-850 rounded text-slate-500 font-mono">
                      {agent.model.split('-').slice(0,2).join('-')}
                    </span>
                    <span className="text-slate-500">
                      {agent.tools?.length || 0} tools
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {sidebarTab === 'configure' && (
          <div className="flex-1 flex flex-col space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Workflow Name</label>
              <input
                type="text"
                value={workflowName}
                onChange={(e) => setWorkflowName(e.target.value)}
                placeholder="e.g. Travel Agent Bot Workflow"
                className="w-full bg-slate-950 border border-slate-850 rounded px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Description</label>
              <textarea
                value={workflowDescription}
                onChange={(e) => setWorkflowDescription(e.target.value)}
                placeholder="Describe what this workflow synthesizes..."
                rows={4}
                className="w-full bg-slate-950 border border-slate-850 rounded px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 transition-colors resize-none"
              />
            </div>

            {/* Selected Node Settings Panel */}
            {selectedNode && (
              <div className="bg-slate-950/80 p-3 rounded-lg border border-slate-850 space-y-3 shadow-inner">
                <p className="text-[10px] text-emerald-400 font-bold uppercase tracking-wider">Configure Node Internals</p>
                <div>
                  <label className="block text-[9px] text-slate-400 uppercase font-bold mb-1">Custom Name / Label</label>
                  <input
                    type="text"
                    value={selectedNode.data.label || ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      setNodes(nds => nds.map(n => n.id === selectedNode.id ? { ...n, data: { ...n.data, label: val } } : n));
                    }}
                    className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-[9px] text-slate-400 uppercase font-bold mb-1">Custom Role</label>
                  <input
                    type="text"
                    value={selectedNode.data.role || ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      setNodes(nds => nds.map(n => n.id === selectedNode.id ? { ...n, data: { ...n.data, role: val } } : n));
                    }}
                    className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-[9px] text-slate-400 uppercase font-bold mb-1">Custom Goal</label>
                  <textarea
                    value={selectedNode.data.goal || ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      setNodes(nds => nds.map(n => n.id === selectedNode.id ? { ...n, data: { ...n.data, goal: val } } : n));
                    }}
                    rows={3}
                    className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 resize-none"
                  />
                </div>
                <label className="flex items-center gap-2 cursor-pointer mt-1">
                  <input
                    type="checkbox"
                    checked={selectedNode.data.requireConfirmation || false}
                    onChange={(e) => {
                      const val = e.target.checked;
                      setNodes(nds => nds.map(n => n.id === selectedNode.id ? { ...n, data: { ...n.data, requireConfirmation: val } } : n));
                    }}
                    className="accent-emerald-500 text-slate-950 rounded border-slate-800 bg-slate-900 focus:ring-0 w-3.5 h-3.5"
                  />
                  <span className="text-[10px] text-slate-300 font-medium select-none">Require Human Confirmation</span>
                </label>
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <button
                onClick={handleSaveWorkflow}
                className="flex-1 py-2 bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 text-slate-950 text-xs font-bold rounded transition-colors shadow-md"
              >
                💾 Save Workflow
              </button>
              <button
                onClick={handleClearCanvas}
                className="px-3 py-2 bg-slate-850 hover:bg-slate-800 border border-slate-750 text-slate-400 hover:text-slate-200 text-xs font-bold rounded transition-colors"
                title="Clear Canvas"
              >
                Reset
              </button>
            </div>
            {currentWorkflowId && (
              <div className="mt-4 p-3 bg-slate-950/60 rounded border border-emerald-900/30 text-xs">
                <p className="text-slate-400 mb-2 font-medium">Currently Editing Saved Workflow:</p>
                <div className="flex items-center justify-between">
                  <span className="text-emerald-400 font-bold">ID: {currentWorkflowId}</span>
                  <button
                    onClick={(e) => handleActivateTelegram(currentWorkflowId, e)}
                    className="px-2.5 py-1 bg-sky-950/40 hover:bg-sky-950/60 border border-sky-900 text-sky-400 font-bold rounded text-[10px] transition-colors"
                  >
                    Activate Telegram
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {sidebarTab === 'saved' && (
          <div className="flex-1 overflow-y-auto space-y-3">
            {savedWorkflows.length === 0 ? (
              <p className="text-xs text-slate-500 italic text-center py-8">No custom workflows saved yet.</p>
            ) : (
              savedWorkflows.map((wf) => (
                <div
                  key={wf.id}
                  onClick={() => handleLoadWorkflow(wf)}
                  className={`p-3 bg-slate-800/80 hover:bg-slate-800 border rounded-lg cursor-pointer transition-all flex flex-col gap-2 relative group ${
                    currentWorkflowId === wf.id ? 'border-emerald-500 ring-1 ring-emerald-500/25' : 'border-slate-750'
                  }`}
                >
                  <div className="flex justify-between items-start gap-1">
                    <h3 className="text-xs font-bold text-slate-200 group-hover:text-emerald-400 transition-colors truncate flex-1">
                      {wf.name}
                    </h3>
                    <button
                      onClick={(e) => handleDeleteWorkflow(wf.id, e)}
                      className="text-slate-500 hover:text-red-400 transition-colors text-[10px] px-1"
                      title="Delete workflow"
                    >
                      ✕
                    </button>
                  </div>
                  {wf.description && (
                    <p className="text-[10px] text-slate-400 line-clamp-2 leading-relaxed">
                      {wf.description}
                    </p>
                  )}
                  <div className="flex justify-between items-center mt-1 border-t border-slate-750/55 pt-2 text-[9px] text-slate-500">
                    <span>
                      {wf.nodes?.length || 0} nodes · {wf.edges?.length || 0} connections
                    </span>
                    {wf.is_active_telegram ? (
                      <span className="px-1.5 py-0.5 bg-emerald-950/80 border border-emerald-800/60 text-emerald-400 rounded font-bold uppercase tracking-wider animate-pulse">
                        Active Tele
                      </span>
                    ) : (
                      <button
                        onClick={(e) => handleActivateTelegram(wf.id, e)}
                        className="px-1.5 py-0.5 bg-slate-900 hover:bg-emerald-950 border border-slate-750 text-slate-400 hover:text-emerald-400 rounded transition-colors font-semibold"
                      >
                        Activate Bot
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

      </aside>

      <main className="flex-1 h-full relative" ref={reactFlowWrapper}>
        <ReactFlow
          nodes={nodes} edges={edges} onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange} onConnect={onConnect}
          onInit={setReactFlowInstance} onDrop={onDrop} onDragOver={onDragOver}
          nodeTypes={nodeTypes} fitView className="bg-slate-950"
        >
          <Background color="#1e293b" gap={16} />
          <Controls className="bg-slate-800 fill-slate-200 border-slate-700" />
        </ReactFlow>

        {/* Floating Test Panel */}
        <div className="absolute bottom-6 left-6 right-6 bg-slate-900/95 border border-slate-800 rounded-xl p-4 shadow-2xl backdrop-blur-md z-10">
          <div className="flex gap-4 items-end">
            <div className="flex-1">
              <div className="flex justify-between items-center mb-2">
                <label className={`text-xs font-bold uppercase tracking-wider ${isPaused ? 'text-amber-400 animate-pulse' : 'text-emerald-400'}`}>
                  {isPaused 
                    ? `⏸️ Workflow Paused: Confirm details for ${pausedAgentName}` 
                    : 'Test Multi-Agent Workflow'
                  }
                </label>
                {workflowThreadId && (
                  <button 
                    onClick={handleResetWorkflowRun}
                    className="text-[10px] text-slate-500 hover:text-rose-400 font-semibold transition-colors"
                  >
                    Reset Session
                  </button>
                )}
              </div>
              <input 
                type="text" 
                value={testInput} 
                onChange={(e) => setTestInput(e.target.value)}
                placeholder={isPaused 
                  ? "Enter confirmation / traveler details (e.g. name, choice) and submit..." 
                  : "Ask the first agent a question..."
                }
                className={`w-full bg-slate-950 border rounded-lg px-4 py-2 text-sm text-slate-200 focus:outline-none focus:ring-1 ${
                  isPaused 
                    ? 'border-amber-500/80 focus:border-amber-500 focus:ring-amber-500/20' 
                    : 'border-slate-800 focus:border-emerald-500 focus:ring-emerald-500/20'
                }`}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !isRunning && (testInput.trim() || !isPaused)) {
                    handleRunWorkflow();
                  }
                }}
              />
            </div>
            <div className="flex gap-2">
              <button 
                onClick={handleRunWorkflow}
                disabled={isRunning || (isPaused && !testInput.trim())}
                className={`font-bold px-6 py-2 rounded-lg transition-all h-[38px] min-w-[120px] shadow-lg ${
                  isPaused 
                    ? 'bg-amber-500 hover:bg-amber-600 disabled:bg-amber-800 text-slate-950' 
                    : 'bg-emerald-500 hover:bg-emerald-600 disabled:bg-emerald-800 text-slate-950'
                }`}
              >
                {isRunning ? 'Running...' : isPaused ? 'Send Reply' : 'Execute Flow'}
              </button>
            </div>
          </div>

          {/* Results Area */}
          {testResults && (
            <div className="mt-4 border-t border-slate-800 pt-4">
              
              {/* Telemetry Dashboard */}
              {testResults.telemetry && (
                <div className="mb-4 flex gap-3 bg-slate-950 p-3 rounded-lg border border-slate-800">
                  <div className="flex-1 border-r border-slate-800">
                    <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Execution Time</p>
                    <p className="text-sm font-mono text-slate-300">{testResults.telemetry.duration_seconds}s</p>
                  </div>
                  <div className="flex-1 border-r border-slate-800 pl-3">
                    <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Tokens Burned</p>
                    <p className="text-sm font-mono text-slate-300">
                      {testResults.telemetry.total_tokens.toLocaleString()} 
                      <span className="text-xs text-slate-500 ml-1">
                        ({testResults.telemetry.input_tokens} IN / {testResults.telemetry.output_tokens} OUT)
                      </span>
                    </p>
                  </div>
                  <div className="flex-1 pl-3">
                    <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Est. Compute Cost</p>
                    <p className="text-sm font-mono text-emerald-400">
                      ${testResults.telemetry.estimated_cost_usd.toFixed(5)}
                    </p>
                  </div>
                </div>
              )}

              <h4 className="text-xs text-slate-400 uppercase tracking-wider mb-2">Execution Log</h4>
              <div className="space-y-3 max-h-60 overflow-y-auto pr-2 mb-4">
                {testResults.steps.map((step, idx) => (
                  <div key={idx} className="bg-slate-950 rounded p-3 border border-slate-800">
                    <span className="text-emerald-400 text-xs font-bold mr-2">Step {idx + 1}: {step.agent_name}</span>
                    <p className="text-slate-300 text-sm mt-1 whitespace-pre-wrap">{step.output_generated}</p>
                  </div>
                ))}
                {isRunning && (
                  <div className="bg-slate-950/40 border border-slate-850 rounded p-3 text-slate-500 text-xs animate-pulse flex items-center gap-2">
                    <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-ping"></span>
                    <span>Agent is executing tasks on the backend...</span>
                  </div>
                )}
              </div>

              {testResults.terminal_log && (
                <div className="border-t border-slate-850 pt-3">
                  <h4 className="text-xs text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                    <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
                    Agent Inner Dialogue & Dynamic Delegations (Cyclic Trace)
                  </h4>
                  <pre className="bg-slate-950 text-emerald-400/90 p-3 rounded-lg border border-slate-800 text-[11px] font-mono max-h-48 overflow-y-auto whitespace-pre-wrap leading-relaxed shadow-inner">
                    {testResults.terminal_log}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}