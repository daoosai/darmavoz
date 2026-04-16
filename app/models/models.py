from datetime import datetime
from typing import List, Optional

from sqlalchemy import ForeignKey, String, Text, DateTime, Boolean, Integer
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.db.database import Base

class Role(Base):
    __tablename__ = 'roles'

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(50), unique=True) # admin, logist, manager
    description: Mapped[Optional[str]] = mapped_column(String(255))

    # Relationships
    users: Mapped[List["User"]] = relationship("User", back_populates="role")

class User(Base):
    __tablename__ = 'users'

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    hashed_password: Mapped[str] = mapped_column(String(255))
    role_id: Mapped[int] = mapped_column(ForeignKey("roles.id"))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    # Relationships
    role: Mapped["Role"] = relationship("Role", back_populates="users")

class Client(Base):
    __tablename__ = 'clients'

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    phone: Mapped[str] = mapped_column(String(20), unique=True, index=True)

    # Relationships
    orders: Mapped[List["Order"]] = relationship("Order", back_populates="client")

class Driver(Base):
    __tablename__ = 'drivers'

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    phone: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    status: Mapped[Optional[str]] = mapped_column(String(50))

    # Relationships
    orders: Mapped[List["Order"]] = relationship("Order", back_populates="driver")

class Order(Base):
    __tablename__ = 'orders'

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    client_id: Mapped[int] = mapped_column(ForeignKey("clients.id"))
    driver_id: Mapped[Optional[int]] = mapped_column(ForeignKey("drivers.id"))
    material: Mapped[str] = mapped_column(String(255))
    volume: Mapped[float]
    address: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(50))

    # Relationships
    client: Mapped["Client"] = relationship("Client", back_populates="orders")
    driver: Mapped[Optional["Driver"]] = relationship("Driver", back_populates="orders")
    events: Mapped[List["EventLog"]] = relationship("EventLog", back_populates="order")

class EventLog(Base):
    __tablename__ = 'events'

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    order_id: Mapped[Optional[int]] = mapped_column(ForeignKey("orders.id"))
    event_type: Mapped[str] = mapped_column(String(100))
    description: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    order: Mapped[Optional["Order"]] = relationship("Order", back_populates="events")
