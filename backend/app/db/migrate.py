from app.db.database import initialize_database


def main() -> None:
    initialize_database()
    print("Database schema initialized.")


if __name__ == "__main__":
    main()
