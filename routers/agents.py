from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
import json
import time

# Absolute imports from your root folder
from database import SessionLocal
import models, schemas

from langchain_core.messages import HumanMessage, AIMessage

from collections import defaultdict, deque
import concurrent.futures

from typing import Annotated, TypedDict, List
import operator

# Change 'app = FastAPI()' to 'router = APIRouter()'
router = APIRouter(
    prefix="/agents",
    tags=["Agents"]
)

# Dependency to get DB session
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# Define the Global State for the Multi-Agent LangGraph
# We use operator.add so that parallel agents can safely append their outputs to the same list
class OrchestratorState(TypedDict):
    original_request: str
    agent_outputs: Annotated[list, operator.add] 
    telemetry: Annotated[list, operator.add]
    execution_log: Annotated[list, operator.add]


@router.post("/", response_model=schemas.AgentResponse)
def create_agent(agent: schemas.AgentCreate, db: Session = Depends(get_db)):
    # 1. Extract the nested config
    config_data = agent.config
    
    # 2. Save the base Agent
    agent_dict = agent.model_dump(exclude={"config"})
    db_agent = models.Agent(**agent_dict)
    db.add(db_agent)
    db.commit()
    db.refresh(db_agent)
    
    # 3. Save the Config and link it via Foreign Key
    if config_data:
        db_config = models.AgentConfig(**config_data.model_dump(), agent_id=db_agent.id)
    else:
        db_config = models.AgentConfig(agent_id=db_agent.id) # Create empty default config
        
    db.add(db_config)
    db.commit()
    
    return db_agent

@router.get("/", response_model=list[schemas.AgentResponse])
def read_agents(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    return db.query(models.Agent).offset(skip).limit(limit).all()

@router.get("/{agent_id}", response_model=schemas.AgentResponse)
def read_agent(agent_id: int, db: Session = Depends(get_db)):
    agent = db.query(models.Agent).filter(models.Agent.id == agent_id).first()
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")
    return agent

@router.put("/{agent_id}", response_model=schemas.AgentResponse)
def update_agent(agent_id: int, agent_update: schemas.AgentUpdate, db: Session = Depends(get_db)):
    db_agent = db.query(models.Agent).filter(models.Agent.id == agent_id).first()
    if db_agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")
    
    config_data = agent_update.config
    update_data = agent_update.model_dump(exclude={"config"}, exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_agent, key, value)
        
    if config_data:
        db_config = db_agent.config
        if not db_config:
            db_config = models.AgentConfig(agent_id=db_agent.id)
            db.add(db_config)
        
        config_update_dict = config_data.model_dump(exclude_unset=True)
        for key, value in config_update_dict.items():
            setattr(db_config, key, value)
        
    db.commit()
    db.refresh(db_agent)
    return db_agent

@router.delete("/{agent_id}")
def delete_agent(agent_id: int, db: Session = Depends(get_db)):
    db_agent = db.query(models.Agent).filter(models.Agent.id == agent_id).first()
    if db_agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")
    
    db.delete(db_agent)
    db.commit()
    return {"message": "Agent deleted successfully"}

@router.post("/{agent_id}/chat")
def chat_with_agent(agent_id: int, chat_request: schemas.ChatRequest, db: Session = Depends(get_db)):
    # 1. Fetch Agent
    db_agent = db.query(models.Agent).filter(models.Agent.id == agent_id).first()
    if not db_agent:
        raise HTTPException(status_code=404, detail="Agent not found")
        
    # 2. Save Human Message to DB
    human_msg = models.Message(
        thread_id=chat_request.thread_id,
        sender_type="human",
        sender_id=chat_request.sender_id,
        content=chat_request.message
    )
    db.add(human_msg)
    db.commit()

    # 3. Load previous thread history from DB
    db_history = db.query(models.Message).filter(
        models.Message.thread_id == chat_request.thread_id
    ).order_by(models.Message.created_at.asc()).all()
    
    # 4. Execute crewAI Runtime
    from runtime import execute_crewai_chat
    try:
        ai_response_text = execute_crewai_chat(db_agent, db_history, chat_request.message, db_session=db, source="Web Sandbox")
    except Exception as e:
        ai_response_text = f"Error during crewAI execution: {str(e)}"
    
    ai_msg = models.Message(
        thread_id=chat_request.thread_id,
        sender_type="agent",
        sender_id=str(db_agent.id),
        content=ai_response_text
    )
    db.add(ai_msg)
    db.commit()
    
    return {"response": ai_response_text}

@router.get("/{agent_id}/chat")
def get_chat_history(agent_id: int, thread_id: str, db: Session = Depends(get_db)):
    messages = db.query(models.Message).filter(
        models.Message.thread_id == thread_id
    ).order_by(models.Message.created_at.asc()).all()
    return messages



@router.post("/workflow/execute")
def execute_workflow(payload: schemas.WorkflowExecute, db: Session = Depends(get_db)):
    if not payload.nodes:
        raise HTTPException(status_code=400, detail="No agents provided in workflow")
    
    try:
        from runtime import execute_workflow_step_by_step, is_workflow_completed
        thread_id = payload.thread_id or "web_workflow_sandbox_default"
        
        # Check if the workflow is already completed to insert cycle boundary
        if is_workflow_completed(payload.nodes, payload.edges, thread_id, db):
            latest_msg = db.query(models.Message).filter(
                models.Message.thread_id == thread_id
            ).order_by(models.Message.created_at.desc()).first()
            if not latest_msg or latest_msg.content != "--- workflow_cycle_boundary ---":
                boundary_msg = models.Message(
                    thread_id=thread_id,
                    sender_type="system",
                    sender_id="system",
                    content="--- workflow_cycle_boundary ---"
                )
                db.add(boundary_msg)
                db.commit()

        # Save human message if it's not already the latest
        latest_msg = db.query(models.Message).filter(
            models.Message.thread_id == thread_id
        ).order_by(models.Message.created_at.desc()).first()
        
        if not latest_msg or latest_msg.content != payload.message or latest_msg.sender_type != "human":
            human_msg = models.Message(
                thread_id=thread_id,
                sender_type="human",
                sender_id="web_user",
                content=payload.message
            )
            db.add(human_msg)
            db.commit()
            
        results = execute_workflow_step_by_step(payload.nodes, payload.edges, payload.message, thread_id, db)
        return {"final_result": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"crewAI Workflow Execution Failed: {str(e)}")

@router.post("/workflow/execute/stream")
def execute_workflow_stream_route(payload: schemas.WorkflowExecute, db: Session = Depends(get_db)):
    if not payload.nodes:
        raise HTTPException(status_code=400, detail="No agents provided in workflow")
    
    import queue
    import threading
    import json
    from fastapi.responses import StreamingResponse
    
    q = queue.Queue()
    
    from runtime import execute_workflow_step_by_step_stream, is_workflow_completed
    
    thread_id = payload.thread_id or "web_workflow_sandbox_default"
    
    # Check if the workflow is already completed to insert cycle boundary
    if is_workflow_completed(payload.nodes, payload.edges, thread_id, db):
        latest_msg = db.query(models.Message).filter(
            models.Message.thread_id == thread_id
        ).order_by(models.Message.created_at.desc()).first()
        if not latest_msg or latest_msg.content != "--- workflow_cycle_boundary ---":
            boundary_msg = models.Message(
                thread_id=thread_id,
                sender_type="system",
                sender_id="system",
                content="--- workflow_cycle_boundary ---"
                )
            db.add(boundary_msg)
            db.commit()

    # Save human message if it's not already the latest
    latest_msg = db.query(models.Message).filter(
        models.Message.thread_id == thread_id
    ).order_by(models.Message.created_at.desc()).first()
    
    if not latest_msg or latest_msg.content != payload.message or latest_msg.sender_type != "human":
        human_msg = models.Message(
            thread_id=thread_id,
            sender_type="human",
            sender_id="web_user",
            content=payload.message
        )
        db.add(human_msg)
        db.commit()
    
    def run_crew():
        try:
            results = execute_workflow_step_by_step_stream(payload.nodes, payload.edges, payload.message, thread_id, db, q)
            q.put({"event": "final_result", "data": results})
        except Exception as e:
            q.put({"event": "error", "data": str(e)})
        finally:
            q.put(None)
            
    thread = threading.Thread(target=run_crew, daemon=True)
    thread.start()
    
    def generator():
        while True:
            try:
                item = q.get(timeout=360)
                if item is None:
                    break
                yield f"data: {json.dumps(item)}\n\n"
            except queue.Empty:
                yield f"data: {json.dumps({'event': 'ping'})}\n\n"
                break
                
    return StreamingResponse(generator(), media_type="text/event-stream")

@router.get("/telemetry/logs")
def get_telemetry_logs(db: Session = Depends(get_db)):
    try:
        return db.query(models.TelemetryLog).order_by(models.TelemetryLog.timestamp.desc()).all()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to query telemetry logs: {str(e)}")

@router.get("/telemetry/stats")
def get_telemetry_stats(db: Session = Depends(get_db)):
    try:
        logs = db.query(models.TelemetryLog).all()
        total_executions = len(logs)
        total_in = sum(l.input_tokens or 0 for l in logs)
        total_out = sum(l.output_tokens or 0 for l in logs)
        total_tokens = sum(l.total_tokens or 0 for l in logs)
        total_cost = sum(l.estimated_cost_usd or 0.0 for l in logs)
        avg_duration = (sum(l.duration_seconds or 0.0 for l in logs) / total_executions) if total_executions > 0 else 0.0
        
        return {
            "total_executions": total_executions,
            "total_input_tokens": total_in,
            "total_output_tokens": total_out,
            "total_tokens": total_tokens,
            "total_estimated_cost_usd": total_cost,
            "average_duration_seconds": round(avg_duration, 2)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to query telemetry stats: {str(e)}")

# --- WORKFLOW ENDPOINTS ---

@router.post("/workflows/", response_model=schemas.WorkflowResponse)
def create_workflow(workflow: schemas.WorkflowCreate, db: Session = Depends(get_db)):
    # Check if a workflow with the same name already exists to allow update/overwrite
    db_wf = db.query(models.Workflow).filter(models.Workflow.name == workflow.name).first()
    if db_wf:
        db_wf.description = workflow.description
        db_wf.nodes = workflow.nodes
        db_wf.edges = workflow.edges
        db_wf.is_active_telegram = workflow.is_active_telegram
        db.commit()
        db.refresh(db_wf)
        return db_wf
        
    db_wf = models.Workflow(
        name=workflow.name,
        description=workflow.description,
        nodes=workflow.nodes,
        edges=workflow.edges,
        is_active_telegram=workflow.is_active_telegram
    )
    db.add(db_wf)
    db.commit()
    db.refresh(db_wf)
    return db_wf

@router.get("/workflows/", response_model=List[schemas.WorkflowResponse])
def list_workflows(db: Session = Depends(get_db)):
    return db.query(models.Workflow).order_by(models.Workflow.created_at.desc()).all()

@router.get("/workflows/{wf_id}", response_model=schemas.WorkflowResponse)
def get_workflow(wf_id: int, db: Session = Depends(get_db)):
    db_wf = db.query(models.Workflow).filter(models.Workflow.id == wf_id).first()
    if not db_wf:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return db_wf

@router.delete("/workflows/{wf_id}")
def delete_workflow(wf_id: int, db: Session = Depends(get_db)):
    db_wf = db.query(models.Workflow).filter(models.Workflow.id == wf_id).first()
    if not db_wf:
        raise HTTPException(status_code=404, detail="Workflow not found")
    db.delete(db_wf)
    db.commit()
    return {"detail": "Workflow deleted successfully"}

@router.post("/workflows/{wf_id}/activate_telegram")
def activate_telegram_workflow(wf_id: int, db: Session = Depends(get_db)):
    # 1. Fetch target workflow
    db_wf = db.query(models.Workflow).filter(models.Workflow.id == wf_id).first()
    if not db_wf:
        raise HTTPException(status_code=404, detail="Workflow not found")
        
    # 2. Deactivate all other workflows
    db.query(models.Workflow).update({models.Workflow.is_active_telegram: False})
    
    # 3. Activate target
    db_wf.is_active_telegram = True
    db.commit()
    return {"detail": f"Workflow '{db_wf.name}' is now active on Telegram"}

@router.post("/workflows/deactivate_telegram")
def deactivate_all_telegram_workflows(db: Session = Depends(get_db)):
    db.query(models.Workflow).update({models.Workflow.is_active_telegram: False})
    db.commit()
    return {"detail": "Telegram bot reverted to single-agent mode"}