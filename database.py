from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.ext.declarative import declarative_base

# The SQLite database URL. This will create a file named 'agent_orc_platform.db' in your folder.
SQLALCHEMY_DATABASE_URL = "sqlite:///./agent_orc_platform.db"

# Create the SQLAlchemy engine
# 'check_same_thread': False is needed specifically for SQLite in FastAPI
engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)

# Create a SessionLocal class to spawn database sessions
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Create a Base class for our models to inherit from
Base = declarative_base()