import os
import threading
import time
import requests
from database import SessionLocal
import models
from runtime import execute_crewai_chat

class TelegramTypingIndicator:
    def __init__(self, token, chat_id, interval=4.0):
        self.token = token
        self.chat_id = chat_id
        self.interval = interval
        self.stop_event = threading.Event()
        self.thread = None

    def _loop(self):
        url = f"https://api.telegram.org/bot{self.token}/sendChatAction"
        payload = {"chat_id": self.chat_id, "action": "typing"}
        while not self.stop_event.is_set():
            try:
                requests.post(url, json=payload, timeout=5)
            except Exception:
                pass
            self.stop_event.wait(self.interval)

    def start(self):
        self.thread = threading.Thread(target=self._loop, daemon=True)
        self.thread.start()

    def stop(self):
        if self.thread:
            self.stop_event.set()
            self.thread.join(timeout=2.0)

def send_telegram_message(token, chat_id, text):
    """
    Sends a message to a Telegram chat, trying with Markdown first,
    and falling back to plain text if Markdown parsing fails.
    """
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    
    # Clean up standard escape characters that might show up in text from JSON strings
    formatted_text = text
    formatted_text = formatted_text.replace('\\n', '\n')
    formatted_text = formatted_text.replace('\\"', '"')
    formatted_text = formatted_text.replace('\\t', '\t')
    formatted_text = formatted_text.replace('\\\\', '\\')
    
    if formatted_text.count('**') % 2 == 0:
        formatted_text = formatted_text.replace('**', '*')
        
    payload = {
        "chat_id": chat_id,
        "text": formatted_text,
        "parse_mode": "Markdown"
    }
    
    try:
        res = requests.post(url, json=payload, timeout=15)
        if res.status_code != 200:
            # Fallback: attempt sending without parse_mode (plain text)
            payload.pop("parse_mode", None)
            payload["text"] = formatted_text  # Use formatted_text so newlines/quotes are preserved
            requests.post(url, json=payload, timeout=15)
    except Exception:
        # Fallback to absolute raw delivery
        try:
            requests.post(url, json={"chat_id": chat_id, "text": formatted_text}, timeout=15)
        except Exception:
            pass

def telegram_polling_loop():
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    if not token:
        print("\n⚠️  TELEGRAM_BOT_TOKEN not found in .env. Telegram channel integration disabled.")
        print("👉 To enable, add: TELEGRAM_BOT_TOKEN=\"your_bot_token\" in .env and restart uvicorn.\n")
        return
        
    print(f"\n🤖 Telegram Bot thread started successfully! Polling for messages...")
    offset = None
    
    while True:
        try:
            url = f"https://api.telegram.org/bot{token}/getUpdates"
            params = {"timeout": 10}
            if offset:
                params["offset"] = offset
                
            res = requests.get(url, params=params, timeout=15)
            if res.status_code != 200:
                time.sleep(5)
                continue
                
            data = res.json()
            if not data.get("ok"):
                time.sleep(5)
                continue
                
            for update in data.get("result", []):
                offset = update["update_id"] + 1
                message = update.get("message")
                if not message or not message.get("text"):
                    continue
                    
                chat_id = message["chat"]["id"]
                user_text = message["text"]
                username = message["from"].get("username") or message["from"].get("first_name") or "TelegramUser"
                
                # Authorization Whitelist Check
                allowed_usernames = os.environ.get("TELEGRAM_ALLOWED_USERNAMES")
                if allowed_usernames:
                    allowed_list = [u.strip().lower() for u in allowed_usernames.split(",") if u.strip()]
                    username_raw = message["from"].get("username")
                    user_id = message["from"].get("id")
                    
                    is_authorized = False
                    if username_raw and username_raw.lower() in allowed_list:
                        is_authorized = True
                    if user_id and str(user_id) in allowed_list:
                        is_authorized = True
                        
                    if not is_authorized:
                        print(f"🔒 Blocked unauthorized access from Telegram username: {username_raw}, ID: {user_id}")
                        send_telegram_message(token, chat_id, "⚠️ *Unauthorized Access*\n\nYou do not have permission to use this bot.")
                        continue

                print(f"📥 Received Telegram message from {username}: '{user_text}'")
                
                # Check for reset/start commands to clear history
                user_text_clean = user_text.strip().lower()
                if user_text_clean in ["/start", "/clear", "/reset"]:
                    db = SessionLocal()
                    try:
                        db.query(models.Message).filter(models.Message.thread_id == f"telegram_chat_{chat_id}").delete()
                        db.commit()
                        
                        # Query active workflow or agent to customize welcome message
                        active_wf = db.query(models.Workflow).filter(models.Workflow.is_active_telegram == True).first()
                        if active_wf:
                            welcome_msg = f"🔄 *Conversation reset!*\n\n🚀 **Active Workflow**: {active_wf.name}\n📝 **Description**: {active_wf.description or 'No description.'}\n\nHow can I help you execute this workflow today?"
                        else:
                            agent = db.query(models.Agent).filter(models.Agent.channels.like('%telegram%')).first()
                            if not agent:
                                agent = db.query(models.Agent).first()
                            agent_name = agent.name if agent else "Assistant"
                            welcome_msg = f"🔄 *Conversation reset!*\n\n🤖 **Active Agent**: {agent_name}\n\nHow can I help you today?"
                            
                        send_telegram_message(token, chat_id, welcome_msg)
                        print(f"🔄 Reset conversation history for Telegram chat {chat_id}")
                        continue
                    except Exception as reset_err:
                        print(f"❌ Failed to reset conversation: {reset_err}")
                    finally:
                        db.close()
                
                # Process the message with an agent in the DB
                db = SessionLocal()
                try:
                    # Look for an agent configured with 'telegram' in its channels,
                    # or fallback to the first available agent
                    agent = db.query(models.Agent).filter(models.Agent.channels.like('%telegram%')).first()
                    if not agent:
                        agent = db.query(models.Agent).first()
                        
                    if not agent:
                        reply_url = f"https://api.telegram.org/bot{token}/sendMessage"
                        requests.post(reply_url, json={"chat_id": chat_id, "text": "Sorry, no agents are configured in the system yet!"})
                        continue
                        
                    # Group messages in a thread specific to this Telegram chat_id
                    thread_id = f"telegram_chat_{chat_id}"
                    
                    # Check if there is an active custom workflow configured for Telegram
                    # and if it is already completed, insert a cycle boundary message first
                    active_wf = db.query(models.Workflow).filter(models.Workflow.is_active_telegram == True).first()
                    if active_wf:
                        from runtime import is_workflow_completed
                        try:
                            if is_workflow_completed(active_wf.nodes, active_wf.edges, thread_id, db):
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
                                    print(f"🔄 Workflow was completed. Inserted cycle boundary for Telegram thread {thread_id}")
                        except Exception as check_err:
                            print(f"⚠️ Failed to check workflow completion: {check_err}")

                    # 1. Save Human Message
                    human_msg = models.Message(
                        thread_id=thread_id,
                        sender_type="human",
                        sender_id=f"telegram_{username}",
                        content=user_text
                    )
                    db.add(human_msg)
                    db.commit()
                    
                    # Query active workflow for immediate feedback
                    active_wf = db.query(models.Workflow).filter(models.Workflow.is_active_telegram == True).first()
                    if active_wf:
                        feedback_text = f"⚡ [Workflow: {active_wf.name}] Responding..."
                    else:
                        feedback_text = f"⚡ [{agent.name}] Responding..."
                        
                    # Send immediate feedback to user so they know prompt was received
                    feedback_url = f"https://api.telegram.org/bot{token}/sendMessage"
                    feedback_res = requests.post(feedback_url, json={"chat_id": chat_id, "text": feedback_text})
                    feedback_msg_id = None
                    if feedback_res.status_code == 200:
                        try:
                            feedback_msg_id = feedback_res.json().get("result", {}).get("message_id")
                        except Exception:
                            pass
                            
                    # Show active typing indicator on Telegram client continuously during generation
                    typing_indicator = TelegramTypingIndicator(token, chat_id)
                    typing_indicator.start()
                    
                    active_wf = db.query(models.Workflow).filter(models.Workflow.is_active_telegram == True).first()
                    reply_text = "Sorry, error executing agent."
                    try:
                        # Check if there is an active custom workflow configured for Telegram
                        if active_wf:
                            # 2. Execute multi-agent crew workflow step-by-step
                            from runtime import execute_workflow_step_by_step
                            
                            # Custom mapping of agent names to progress phrases
                            progress_phrases = {
                                "TravelSearcher": "Looking for flights...",
                                "TravelManager": "Consulting Travel Manager...",
                                "TicketBooker": "Booking travel tickets...",
                                "ItineraryScheduler": "Building travel itinerary...",
                                "GoogleCalendarIntegrator": "Generating Google Calendar event...",
                                "TelegramFormatter": "Formatting response for Telegram...",
                            }
                            
                            def telegram_step_callback(agent_name, event, phase, output):
                                if event == "start":
                                    phrase = progress_phrases.get(agent_name)
                                    if not phrase:
                                        import re
                                        clean_name = re.sub(r'(?<!^)(?=[A-Z])', ' ', agent_name)
                                        phrase = f"{clean_name} is processing..."
                                    send_telegram_message(token, chat_id, phrase)
                                elif event == "complete":
                                    # Hide finished output of intermediate steps entirely
                                    pass

                            reply_text = execute_workflow_step_by_step(
                                active_wf.nodes,
                                active_wf.edges,
                                user_text,
                                thread_id,
                                db,
                                step_callback=telegram_step_callback
                            )
                        else:
                            # 2. Load previous history
                            db_history = db.query(models.Message).filter(
                                models.Message.thread_id == thread_id
                            ).order_by(models.Message.created_at.asc()).all()
                            
                            # 3. Execute single-agent crewAI chat
                            reply_text = execute_crewai_chat(agent, db_history[:-1], user_text, db_session=db, source="Telegram")
                            
                            # Save Agent Message
                            ai_msg = models.Message(
                                thread_id=thread_id,
                                sender_type="agent",
                                sender_id=str(agent.id),
                                content=reply_text
                            )
                            db.add(ai_msg)
                            db.commit()
                    finally:
                        typing_indicator.stop()
                    
                    # 5. Delete or update the "Responding..." message, then send the actual final response
                    if feedback_msg_id:
                        try:
                            delete_url = f"https://api.telegram.org/bot{token}/deleteMessage"
                            requests.post(delete_url, json={"chat_id": chat_id, "message_id": feedback_msg_id})
                        except Exception:
                            pass
                            
                    send_telegram_message(token, chat_id, reply_text)
                    print(f"📤 Sent Telegram reply to {username}: '{reply_text}'")
                    
                except Exception as e:
                    print(f"❌ Error processing Telegram message: {e}")
                    try:
                        reply_url = f"https://api.telegram.org/bot{token}/sendMessage"
                        requests.post(reply_url, json={"chat_id": chat_id, "text": f"Error during execution: {str(e)}"})
                    except Exception:
                        pass
                finally:
                    db.close()
                    
        except Exception as e:
            print(f"⚠️ Telegram polling loop encountered an error: {e}")
            time.sleep(10)

def start_telegram_bot():
    t = threading.Thread(target=telegram_polling_loop, daemon=True)
    t.start()
