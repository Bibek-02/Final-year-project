
# This script seeds the initial admin user into the database.

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
from app.core.security import get_user, create_user

load_dotenv()


def main():
    parser = argparse.ArgumentParser(description="Seed the initial admin user.")
    parser.add_argument("--username", default=os.getenv("ADMIN_USERNAME", "admin"))
    parser.add_argument("--password", default=os.getenv("ADMIN_PASSWORD", "admin123"))
    args = parser.parse_args()

    if get_user(args.username):
        print(f"User '{args.username}' already exists. Nothing to do.")
        return

    create_user(args.username, args.password, role="admin", assigned_store=None)
    print(f"Admin user '{args.username}' created.")
    if not os.getenv("ADMIN_PASSWORD"):
        print("Using the default password — change it after first login, "
              "or set ADMIN_PASSWORD before running this script.")


if __name__ == "__main__":
    main()
