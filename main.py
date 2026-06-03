from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from database import engine
import models
from routers import agents
from dotenv import load_dotenv

# Load the environment variables from the .env file
load_dotenv()

models.Base.metadata.create_all(bind=engine)

# Safely run SQLite schema migration to add max_tokens column if not already present
from sqlalchemy import text
with engine.connect() as conn:
    try:
        conn.execute(text("ALTER TABLE agents ADD COLUMN max_tokens INTEGER DEFAULT 1000;"))
        conn.commit()
    except Exception:
        pass
    try:
        conn.execute(text("ALTER TABLE agents ADD COLUMN goal TEXT;"))
        conn.commit()
    except Exception:
        pass

app = FastAPI(title="AI Agent Orchestrator")

# Configure CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(agents.router)

def seed_default_workflow(db):
    import models
    # Retrieve the seeded agents to get their correct database IDs
    travel_searcher = db.query(models.Agent).filter(models.Agent.name == "TravelSearcher").first()
    travel_manager = db.query(models.Agent).filter(models.Agent.name == "TravelManager").first()
    ticket_booker = db.query(models.Agent).filter(models.Agent.name == "TicketBooker").first()
    itinerary_scheduler = db.query(models.Agent).filter(models.Agent.name == "ItineraryScheduler").first()
    google_calendar = db.query(models.Agent).filter(models.Agent.name == "GoogleCalendarIntegrator").first()
    telegram_formatter = db.query(models.Agent).filter(models.Agent.name == "TelegramFormatter").first()
    
    # Query recruitment agents
    rec_manager = db.query(models.Agent).filter(models.Agent.name == "RecruitmentManager").first()
    rec_sourcer = db.query(models.Agent).filter(models.Agent.name == "CandidateSlotSourcer").first()
    rec_booker = db.query(models.Agent).filter(models.Agent.name == "InterviewSlotBooker").first()
    rec_planner = db.query(models.Agent).filter(models.Agent.name == "InterviewAgendaPlanner").first()
    rec_inviter = db.query(models.Agent).filter(models.Agent.name == "CalendarInviter").first()
    rec_coordinator = db.query(models.Agent).filter(models.Agent.name == "RecruitmentCoordinator").first()
    
    if not (rec_manager and rec_sourcer and rec_booker and rec_planner and rec_inviter and rec_coordinator):
        rec_manager = travel_manager
        rec_sourcer = travel_searcher
        rec_booker = ticket_booker
        rec_planner = itinerary_scheduler
        rec_inviter = google_calendar
        rec_coordinator = telegram_formatter

    if not (travel_searcher and travel_manager and ticket_booker and itinerary_scheduler and google_calendar and telegram_formatter):
        return
        
    # Check if the default travel workflow already exists
    existing_wf = db.query(models.Workflow).filter(models.Workflow.name == "Travel Concierge Workflow").first()
    # Recreate default workflows to apply new hub-spoke structure
    db.query(models.Workflow).delete()
    db.commit()
        
    # Build node IDs for Travel Concierge Workflow
    ts_id = f"agent_{travel_searcher.id}_default_1"
    tm_id = f"agent_{travel_manager.id}_default_manager"
    tb_id = f"agent_{ticket_booker.id}_default_2"
    is_id = f"agent_{itinerary_scheduler.id}_default_3"
    gc_id = f"agent_{google_calendar.id}_default_4"
    tf_id = f"agent_{telegram_formatter.id}_default_5"
    
    travel_nodes = [
        {
            "id": ts_id,
            "type": "agentNode",
            "position": {"x": 200, "y": 300},
            "data": {
                "dbId": travel_searcher.id,
                "label": travel_searcher.name,
                "role": travel_searcher.role,
                "goal": "Search and retrieve the best travel and flight options for the user destination and origin.",
                "model": travel_searcher.model,
                "requireConfirmation": False
            }
        },
        {
            "id": tm_id,
            "type": "agentNode",
            "position": {"x": 500, "y": 300},
            "data": {
                "dbId": travel_manager.id,
                "label": travel_manager.name,
                "role": travel_manager.role,
                "goal": "Deliver a complete, final travel itinerary with all details, ensuring tickets are booked, calendar planning is completed, calendar invites are generated, and a formatted telegram-ready itinerary is delivered automatically without requiring manual step-by-step requests from the user.",
                "model": travel_manager.model,
                "requireConfirmation": True  # HUMAN IN THE LOOP ACTIVE ON MANAGER!
            }
        },
        {
            "id": tb_id,
            "type": "agentNode",
            "position": {"x": 350, "y": 100},
            "data": {
                "dbId": ticket_booker.id,
                "label": ticket_booker.name,
                "role": ticket_booker.role,
                "goal": "Book flight tickets and return confirmation references.",
                "model": ticket_booker.model,
                "requireConfirmation": False
            }
        },
        {
            "id": is_id,
            "type": "agentNode",
            "position": {"x": 650, "y": 100},
            "data": {
                "dbId": itinerary_scheduler.id,
                "label": itinerary_scheduler.name,
                "role": itinerary_scheduler.role,
                "goal": "Schedule the itinerary details on the calendar and outline the day-by-day travel plan.",
                "model": itinerary_scheduler.model,
                "requireConfirmation": False
            }
        },
        {
            "id": gc_id,
            "type": "agentNode",
            "position": {"x": 650, "y": 500},
            "data": {
                "dbId": google_calendar.id,
                "label": google_calendar.name,
                "role": google_calendar.role,
                "goal": "Create google calendar events and retrieve save URLs.",
                "model": google_calendar.model,
                "requireConfirmation": False
            }
        },
        {
            "id": tf_id,
            "type": "agentNode",
            "position": {"x": 350, "y": 500},
            "data": {
                "dbId": telegram_formatter.id,
                "label": telegram_formatter.name,
                "role": telegram_formatter.role,
                "goal": "Produce a polished, emoji-rich, telegram-ready summary of the final booked itinerary and calendar link with clear formatting, and no literal \\n characters.",
                "model": telegram_formatter.model,
                "requireConfirmation": False
            }
        }
    ]
    
    travel_edges = [
        {"id": f"e_{ts_id}_{tm_id}", "source": ts_id, "target": tm_id},
        {"id": f"e_{tm_id}_{tb_id}", "source": tm_id, "target": tb_id},
        {"id": f"e_{tm_id}_{is_id}", "source": tm_id, "target": is_id},
        {"id": f"e_{tm_id}_{gc_id}", "source": tm_id, "target": gc_id},
        {"id": f"e_{tm_id}_{tf_id}", "source": tm_id, "target": tf_id}
    ]
    
    # Deactivate any other workflows for Telegram to make this one the default active
    db.query(models.Workflow).update({models.Workflow.is_active_telegram: False})
    
    default_wf = models.Workflow(
        name="Travel Concierge Workflow",
        description="The default travel booking workflow containing a human confirmation loop coordinated by the Travel Manager.",
        nodes=travel_nodes,
        edges=travel_edges,
        is_active_telegram=True
    )
    db.add(default_wf)
    
    # Build node IDs for Interview Scheduling Pipeline
    sourcer_id = f"agent_{rec_sourcer.id}_default_sourcer"
    manager_id = f"agent_{rec_manager.id}_default_rec_manager"
    booker_id = f"agent_{rec_booker.id}_default_booker"
    planner_id = f"agent_{rec_planner.id}_default_planner"
    inviter_id = f"agent_{rec_inviter.id}_default_inviter"
    coordinator_id = f"agent_{rec_coordinator.id}_default_coordinator"
    
    interview_nodes = [
        {
            "id": sourcer_id,
            "type": "agentNode",
            "position": {"x": 200, "y": 300},
            "data": {
                "dbId": rec_sourcer.id,
                "label": rec_sourcer.name,
                "role": rec_sourcer.role,
                "goal": "Source candidate slots and negotiation inputs.",
                "model": rec_sourcer.model,
                "requireConfirmation": False
            }
        },
        {
            "id": manager_id,
            "type": "agentNode",
            "position": {"x": 500, "y": 300},
            "data": {
                "dbId": rec_manager.id,
                "label": rec_manager.name,
                "role": rec_manager.role,
                "goal": "Deliver a complete, final interview schedule with prep agenda, ensuring slots are booked, calendar invites are sent, and a formatted coordinator confirmation is delivered without forcing manual step-by-step guidance.",
                "model": rec_manager.model,
                "requireConfirmation": True  # HUMAN IN THE LOOP ACTIVE ON MANAGER!
            }
        },
        {
            "id": booker_id,
            "type": "agentNode",
            "position": {"x": 350, "y": 100},
            "data": {
                "dbId": rec_booker.id,
                "label": rec_booker.name,
                "role": rec_booker.role,
                "goal": "Book interview slot confirmations.",
                "model": rec_booker.model,
                "requireConfirmation": False
            }
        },
        {
            "id": planner_id,
            "type": "agentNode",
            "position": {"x": 650, "y": 100},
            "data": {
                "dbId": rec_planner.id,
                "label": rec_planner.name,
                "role": rec_planner.role,
                "goal": "Create detailed prep agenda and study plan for the interview.",
                "model": rec_planner.model,
                "requireConfirmation": False
            }
        },
        {
            "id": inviter_id,
            "type": "agentNode",
            "position": {"x": 650, "y": 500},
            "data": {
                "dbId": rec_inviter.id,
                "label": rec_inviter.name,
                "role": rec_inviter.role,
                "goal": "Send google calendar invites and links to candidates.",
                "model": rec_inviter.model,
                "requireConfirmation": False
            }
        },
        {
            "id": coordinator_id,
            "type": "agentNode",
            "position": {"x": 350, "y": 500},
            "data": {
                "dbId": rec_coordinator.id,
                "label": rec_coordinator.name,
                "role": rec_coordinator.role,
                "goal": "Format a polished recruitment telegram message with details and calendar links, without outputting literal \\n.",
                "model": rec_coordinator.model,
                "requireConfirmation": False
            }
        }
    ]
    
    interview_edges = [
        {"id": f"e_{sourcer_id}_{manager_id}", "source": sourcer_id, "target": manager_id},
        {"id": f"e_{manager_id}_{booker_id}", "source": manager_id, "target": booker_id},
        {"id": f"e_{manager_id}_{planner_id}", "source": manager_id, "target": planner_id},
        {"id": f"e_{manager_id}_{inviter_id}", "source": manager_id, "target": inviter_id},
        {"id": f"e_{manager_id}_{coordinator_id}", "source": manager_id, "target": coordinator_id}
    ]
    
    interview_wf = models.Workflow(
        name="Interview Scheduling Pipeline",
        description="Recruitment workflow designed in a manager-worker hub-spoke topology for interview scheduling.",
        nodes=interview_nodes,
        edges=interview_edges,
        is_active_telegram=False
    )
    db.add(interview_wf)
    db.commit()
    print("🌱 Seeded default active workflows successfully!")

def seed_default_agents():
    from database import SessionLocal
    import models
    db = SessionLocal()
    try:
        default_agents = [
            {
                "name": "TravelManager",
                "role": "Travel Experience Manager",
                "system_prompt": "You are the Travel Experience Manager coordinating user travel. You examine search results from TravelSearcher, summarize travel options to the user, ask the user to clarify/confirm their choice, and once confirmed, pass the booking details to the TicketBooker, ItineraryScheduler, GoogleCalendarIntegrator, and TelegramFormatter to deliver a complete booking and itinerary package.",
                "goal": "Deliver a complete, final travel itinerary with all details, ensuring tickets are booked, calendar planning is completed, calendar invites are generated, and a formatted telegram-ready itinerary is delivered automatically without requiring manual step-by-step requests from the user.",
                "model": "gemma-4-26b-a4b-it",
                "max_tokens": 4000,
                "tools": [],
                "channels": ["web", "telegram"]
            },
            {
                "name": "TravelSearcher",
                "role": "Travel Search Specialist",
                "system_prompt": "You are a search specialist. Use search_travel_options to find the best flights between the requested origin and destination. Pass the list of options to the booking agent.",
                "goal": "Search and retrieve the best travel and flight options for the user destination and origin.",
                "model": "gemma-4-26b-a4b-it",
                "max_tokens": 4000,
                "tools": ["search_travel_options"],
                "channels": ["web", "telegram"]
            },
            {
                "name": "TicketBooker",
                "role": "Travel Booking Coordinator",
                "system_prompt": "You book travel tickets based on the option IDs provided by the Search Specialist. Use book_travel_tickets to confirm the reservation.",
                "goal": "Book flight tickets and return confirmation references.",
                "model": "gemma-4-26b-a4b-it",
                "max_tokens": 4000,
                "tools": ["book_travel_tickets"],
                "channels": ["web", "telegram"]
            },
            {
                "name": "ItineraryScheduler",
                "role": "Itinerary & Calendar Planner",
                "system_prompt": "You schedule travel dates on the calendar and outline a detailed daily travel itinerary based on the booked flight details. Use add_to_calendar_and_itinerary.",
                "goal": "Schedule the itinerary details on the calendar and outline the day-by-day travel plan.",
                "model": "gemma-4-26b-a4b-it",
                "max_tokens": 4000,
                "tools": ["add_to_calendar_and_itinerary"],
                "channels": ["web", "telegram"]
            },
            {
                "name": "TelegramFormatter",
                "role": "Telegram Content Formatter",
                "system_prompt": "You take the final booking reference, itinerary details, and flight information, and format them into a polished, emoji-rich summary optimized for display on a Telegram chat screen. Use clear lists, clean spacing, and bold headlines. Do not output raw JSON, thinking tags, or markdown backtick code blocks. Do not escape newlines as \\n characters, but write them directly so they render beautifully.",
                "goal": "Produce a polished, emoji-rich, telegram-ready summary of the final booked itinerary and calendar link with clear formatting, and no literal \\n characters.",
                "model": "gemma-4-26b-a4b-it",
                "max_tokens": 4000,
                "tools": [],
                "channels": ["web", "telegram"]
            },
            {
                "name": "GoogleCalendarIntegrator",
                "role": "Google Calendar Integration Specialist",
                "system_prompt": "You are a Calendar Integration Specialist. You take the booking confirmation and itinerary details, and call add_google_calendar_event to generate a direct Google Calendar save link. Make sure to output this calendar link prominently for the user.",
                "goal": "Create google calendar events and retrieve save URLs.",
                "model": "gemma-4-26b-a4b-it",
                "max_tokens": 4000,
                "tools": ["add_google_calendar_event"],
                "channels": ["web", "telegram"]
            },
            {
                "name": "RecruitmentManager",
                "role": "Recruitment Coordinator & Manager",
                "system_prompt": "You are the Recruitment Manager coordinating candidate interview scheduling. You examine available slots from Candidate Slot Sourcer, summarize slot options to the candidate, ask the candidate to confirm their preferred slot, and once confirmed, pass the details to the Interview Slot Booker, Interview Agenda Planner, Calendar Inviter, and Recruitment Coordinator to finalize the interview.",
                "goal": "Deliver a complete, final interview schedule with prep agenda, ensuring slots are booked, calendar invites are sent, and a formatted coordinator confirmation is delivered without forcing manual step-by-step guidance.",
                "model": "gemma-4-26b-a4b-it",
                "max_tokens": 4000,
                "tools": [],
                "channels": ["web", "telegram"]
            },
            {
                "name": "CandidateSlotSourcer",
                "role": "CV & Availability Sourcer",
                "system_prompt": "You are an interview availability sourcer. Use search_travel_options to look up CV details or slots and retrieve potential interview times for the candidate. Pass the options to the Recruitment Manager.",
                "goal": "Source candidate slots and negotiation inputs.",
                "model": "gemma-4-26b-a4b-it",
                "max_tokens": 4000,
                "tools": ["search_travel_options"],
                "channels": ["web", "telegram"]
            },
            {
                "name": "InterviewSlotBooker",
                "role": "Slot Negotiation Agent",
                "system_prompt": "You book interview slot confirmations. Use book_travel_tickets to save confirmation details to the database.",
                "goal": "Book interview slot confirmations.",
                "model": "gemma-4-26b-a4b-it",
                "max_tokens": 4000,
                "tools": ["book_travel_tickets"],
                "channels": ["web", "telegram"]
            },
            {
                "name": "InterviewAgendaPlanner",
                "role": "Interview Prep Specialist",
                "system_prompt": "You create a detailed prep agenda and study plan for the candidate. Use add_to_calendar_and_itinerary to schedule slot details/itinerary to the database calendar list.",
                "goal": "Create detailed prep agenda and study plan for the interview.",
                "model": "gemma-4-26b-a4b-it",
                "max_tokens": 4000,
                "tools": ["add_to_calendar_and_itinerary"],
                "channels": ["web", "telegram"]
            },
            {
                "name": "CalendarInviter",
                "role": "Google Calendar Publisher",
                "system_prompt": "You are a Calendar Publisher. Take the slot booking confirmation and call add_google_calendar_event to generate a Google Calendar save link.",
                "goal": "Send google calendar invites and links to candidates.",
                "model": "gemma-4-26b-a4b-it",
                "max_tokens": 4000,
                "tools": ["add_google_calendar_event"],
                "channels": ["web", "telegram"]
            },
            {
                "name": "RecruitmentCoordinator",
                "role": "Recruitment Message Formatter",
                "system_prompt": "You format the final interview slot summary, agenda details, and calendar links into a polished summary optimized for Telegram. Do not output raw JSON, thinking tags, or markdown backtick code blocks. Do not escape newlines as \\n, but write them directly.",
                "goal": "Format a polished recruitment telegram message with details and calendar links, without outputting literal \\n.",
                "model": "gemma-4-26b-a4b-it",
                "max_tokens": 4000,
                "tools": [],
                "channels": ["web", "telegram"]
            }
        ]
        
        for agent_data in default_agents:
            existing = db.query(models.Agent).filter(models.Agent.name == agent_data["name"]).first()
            if existing:
                existing.role = agent_data["role"]
                existing.system_prompt = agent_data["system_prompt"]
                existing.goal = agent_data["goal"]
                existing.tools = agent_data["tools"]
                existing.channels = agent_data["channels"]
                existing.max_tokens = agent_data["max_tokens"]
                db.commit()
                print(f"🌱 Updated default agent config: {existing.name}")
            else:
                db_agent = models.Agent(
                    name=agent_data["name"],
                    role=agent_data["role"],
                    system_prompt=agent_data["system_prompt"],
                    goal=agent_data["goal"],
                    model=agent_data["model"],
                    max_tokens=agent_data["max_tokens"],
                    tools=agent_data["tools"],
                    channels=agent_data["channels"]
                )
                db.add(db_agent)
                db.commit()
                db.refresh(db_agent)
                
                db_config = models.AgentConfig(agent_id=db_agent.id)
                db.add(db_config)
                db.commit()
                print(f"🌱 Seeded default agent: {db_agent.name}")
                
        # Seed default workflow
        seed_default_workflow(db)
        
    except Exception as err:
        print(f"Error seeding default agents: {err}")
    finally:
        db.close()

@app.on_event("startup")
def startup_event():
    # 1. Seed agents
    seed_default_agents()
    
    # 2. Start telegram bot
    try:
        from telegram_bot import start_telegram_bot
        start_telegram_bot()
    except Exception as e:
        print(f"Failed to start Telegram bot: {e}")