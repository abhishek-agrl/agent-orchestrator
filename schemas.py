from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime
from typing import Dict, Any

# --- AGENT CONFIG SCHEMAS ---

class AgentConfigBase(BaseModel):
    schedules: Dict[str, Any] = {}
    memory: Dict[str, Any] = {}
    skills: List[str] = []
    interaction_rules: List[str] = []
    guardrails: List[str] = []

class AgentConfigCreate(AgentConfigBase):
    agent_id: int

class AgentConfigUpdate(BaseModel):
    schedules: Optional[Dict[str, Any]] = None
    memory: Optional[Dict[str, Any]] = None
    skills: Optional[List[str]] = None
    interaction_rules: Optional[List[str]] = None
    guardrails: Optional[List[str]] = None

class AgentConfigResponse(AgentConfigBase):
    id: int
    agent_id: int

    class Config:
        from_attributes = True

# --- MESSAGE SCHEMAS ---

class MessageBase(BaseModel):
    thread_id: str
    sender_type: str
    sender_id: Optional[str] = None
    content: str

class MessageCreate(MessageBase):
    pass

class MessageResponse(MessageBase):
    id: int
    created_at: datetime

    class Config:
        from_attributes = True

class ChatRequest(BaseModel):
    thread_id: str
    message: str
    sender_id: str = "human"

class NodeData(BaseModel):
    id: str
    db_id: int
    label: Optional[str] = None
    role: Optional[str] = None
    goal: Optional[str] = None
    require_confirmation: Optional[bool] = False

class EdgeData(BaseModel):
    source: str
    target: str

class WorkflowExecute(BaseModel):
    nodes: List[NodeData]
    edges: List[EdgeData]
    message: str
    thread_id: Optional[str] = None

# --- AGENT SCHEMAS ---

class AgentBase(BaseModel):
    name: str
    role: str
    system_prompt: str
    goal: Optional[str] = None
    model: str
    max_tokens: Optional[int] = 1000
    tools: List[str] = []
    channels: List[str] = []

class AgentCreate(AgentBase):
    config: Optional[AgentConfigBase] = None

class AgentUpdate(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    system_prompt: Optional[str] = None
    goal: Optional[str] = None
    model: Optional[str] = None
    max_tokens: Optional[int] = None
    tools: Optional[List[str]] = None
    channels: Optional[List[str]] = None
    config: Optional[AgentConfigUpdate] = None

class AgentResponse(AgentBase):
    id: int
    config: Optional[AgentConfigResponse] = None

    class Config:
        from_attributes = True

# --- WORKFLOW SCHEMAS ---

class WorkflowBase(BaseModel):
    name: str
    description: Optional[str] = None
    nodes: List[Dict[str, Any]]
    edges: List[Dict[str, Any]]
    is_active_telegram: Optional[bool] = False

class WorkflowCreate(WorkflowBase):
    pass

class WorkflowUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    nodes: Optional[List[Dict[str, Any]]] = None
    edges: Optional[List[Dict[str, Any]]] = None
    is_active_telegram: Optional[bool] = None

class WorkflowResponse(WorkflowBase):
    id: int
    created_at: datetime

    class Config:
        from_attributes = True

