from sqlalchemy import Column, Integer, String, JSON, ForeignKey, DateTime, Text, Float, Boolean
from sqlalchemy.orm import relationship
from datetime import datetime
from database import Base # Importing Base properly to avoid the metadata trap!

class Agent(Base):
    __tablename__ = "agents"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True, nullable=False)
    role = Column(String, nullable=False)
    system_prompt = Column(Text, nullable=False) # Changed to Text for longer prompts
    goal = Column(Text, nullable=True)
    model = Column(String, nullable=False)
    max_tokens = Column(Integer, default=1000, nullable=True) # Custom max new token limit
    
    tools = Column(JSON, default=list) 
    channels = Column(JSON, default=list)

    # Relationship to fetch config easily: agent.config
    config = relationship("AgentConfig", back_populates="agent", uselist=False, cascade="all, delete-orphan")

class AgentConfig(Base):
    __tablename__ = "agent_configs"

    id = Column(Integer, primary_key=True, index=True)
    agent_id = Column(Integer, ForeignKey("agents.id"), unique=True, nullable=False)
    
    # Storing these as JSON provides flexibility for the workflow builder
    schedules = Column(JSON, default=dict)
    memory = Column(JSON, default=dict)
    skills = Column(JSON, default=list)
    interaction_rules = Column(JSON, default=list)
    guardrails = Column(JSON, default=list)

    agent = relationship("Agent", back_populates="config")

class Message(Base):
    __tablename__ = "messages"

    id = Column(Integer, primary_key=True, index=True)
    thread_id = Column(String, index=True, nullable=False) # Groups messages into a specific conversation/workflow
    sender_type = Column(String, nullable=False) # e.g., 'human', 'agent', 'system'
    sender_id = Column(String, nullable=True) # Could be an agent.id or a human's phone number from WhatsApp
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

class TelemetryLog(Base):
    __tablename__ = "telemetry_logs"

    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime, default=datetime.utcnow)
    source = Column(String, nullable=False) # e.g., 'Telegram', 'Web Sandbox', 'Workflow'
    agent_id = Column(Integer, nullable=True)
    agent_name = Column(String, nullable=True)
    prompt = Column(Text, nullable=False)
    response = Column(Text, nullable=True)
    duration_seconds = Column(Float, default=0.0)
    input_tokens = Column(Integer, default=0)
    output_tokens = Column(Integer, default=0)
    total_tokens = Column(Integer, default=0)
    estimated_cost_usd = Column(Float, default=0.0)
    terminal_log = Column(Text, nullable=True)

class Workflow(Base):
    __tablename__ = "workflows"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, unique=True)
    description = Column(Text, nullable=True)
    nodes = Column(JSON, nullable=False) # React Flow nodes array
    edges = Column(JSON, nullable=False) # React Flow edges array
    is_active_telegram = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)