import sys
from sqlalchemy.orm import Session
from database import SessionLocal
import models
from runtime import execute_crewai_chat, execute_crewai_workflow

def run_test():
    print("Testing crewAI Runtime Integration...")
    db = SessionLocal()
    try:
        # Fetch first agent from DB
        db_agent = db.query(models.Agent).first()
        if not db_agent:
            print("No agents in database to test. Creating mock agent...")
            db_agent = models.Agent(
                name="FactFinderBot",
                role="Fact Finder",
                system_prompt="You extract dates, numbers, and facts. Be extremely precise.",
                model="gemini-1.5-flash",
                tools=[],
                channels=["web"]
            )
            db.add(db_agent)
            db.commit()
            db.refresh(db_agent)
            
        print(f"Testing single-agent chat with: '{db_agent.name}'")
        res = execute_crewai_chat(db_agent, [], "What is the capital of France and what is its population?")
        print("\n--- SINGLE-AGENT CHAT RESULT ---")
        print(res)
        print("--------------------------------\n")
        
        # Test Workflow payload
        print("Testing multi-agent workflow...")
        class MockNode:
            def __init__(self, id, db_id):
                self.id = id
                self.db_id = db_id
                
        class MockEdge:
            def __init__(self, source, target):
                self.source = source
                self.target = target
                
        # Get up to 3 agents
        agents = db.query(models.Agent).limit(3).all()
        if len(agents) < 2:
            print("Need at least 2 agents in database to run multi-agent test.")
            return
            
        nodes = [MockNode(f"node_{i}", agent.id) for i, agent in enumerate(agents)]
        edges = []
        for i in range(len(nodes) - 1):
            edges.append(MockEdge(nodes[i].id, nodes[i+1].id))
            
        print(f"Connecting agents in workflow: {' -> '.join([a.name for a in agents])}")
        workflow_res = execute_crewai_workflow(nodes, edges, "Write a 3-sentence summary about the history of space exploration.", db)
        
        print("\n--- WORKFLOW RESULT ---")
        print("Final Result:", workflow_res["final_result"])
        print("\nSteps:")
        for step in workflow_res["steps"]:
            print(f"- {step['agent_name']}: {step['output_generated'][:100]}...")
        print("\nTelemetry:")
        print(workflow_res["telemetry"])
        print("----------------------\n")
        
    except Exception as e:
        print("Test failed with exception:", e)
        import traceback
        traceback.print_exc()
    finally:
        db.close()

if __name__ == "__main__":
    run_test()
