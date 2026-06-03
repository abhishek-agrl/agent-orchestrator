import requests
import json

BASE_URL = "http://127.0.0.1:8000"

def test_full_agent_flow():
    print("🚀 Starting Backend Integration Test...\n")
    
    # 1. Create the Agent
    agent_payload = {
        "name": "Gemini-Orchestrator",
        "role": "General Assistant",
        "system_prompt": "You are a helpful assistant. Be concise and professional.",
        "model": "gemma-4-26b-a4b-it",
        "tools": [],
        "channels": ["web"]
    }
    
    print("Step 1: Creating agent via POST /agents/ ...")
    create_res = requests.post(f"{BASE_URL}/agents/", json=agent_payload)
    
    if create_res.status_code != 200:
        print(f"❌ Failed to create agent: {create_res.text}")
        return
        
    agent = create_res.json()
    agent_id = agent["id"]
    print(f"✅ Agent created successfully! ID: {agent_id}\n")
    
    # 2. Send a Chat Message
    chat_payload = {
        "thread_id": "automation_thread_001",
        "message": "Hello Gemini! Tell me one interesting fact about space in 10 words.",
        "sender_id": "tester"
    }
    
    print(f"Step 2: Sending message to Agent {agent_id} via POST /agents/{agent_id}/chat ...")
    print(f"Prompt sent: \"{chat_payload['message']}\"")
    print("⏳ Waiting for Gemini & LangGraph response...")
    
    chat_res = requests.post(f"{BASE_URL}/agents/{agent_id}/chat", json=chat_payload)
    
    if chat_res.status_code != 200:
        print(f"❌ Chat endpoint failed: {chat_res.text}")
        return
        
    response_data = chat_res.json()
    print("\n✅ Response Received from Agent:")
    print(f"🤖 Configured Agent says: {response_data['response']}\n")
    print("🎉 Test completed successfully!")

if __name__ == "__main__":
    # Ensure your uvicorn server is running before executing this script!
    try:
        test_full_agent_flow()
    except requests.exceptions.ConnectionError:
        print("❌ Error: Could not connect to the server. Is 'uvicorn main:app --reload' running?")