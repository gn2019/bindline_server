import uuid

from flask import Blueprint, request, redirect, url_for, flash
from flask_login import login_user, logout_user, current_user
from werkzeug.security import generate_password_hash, check_password_hash
from database_setup import db, User

auth_bp = Blueprint('auth', __name__)


def get_current_user_uuid():
    return current_user.uuid


def handle_registration(username, password):
    # username must be alphanumeric and between 3 and 20 characters
    if not username.isalnum() or not 3 <= len(username) <= 20:
        flash('Invalid username.')
        return {'success': False}, 400

    existing_user = User.query.filter_by(username=username).first()
    if existing_user:
        flash('Username already exists.')
        return {'success': False}, 409

    hashed_password = generate_password_hash(password)
    new_user = User(username=username, password=hashed_password, uuid=str(uuid.uuid4()))
    db.session.add(new_user)
    db.session.commit()

    flash('Registration successful!')
    if login_user(new_user):
        current_user.uuid = new_user.uuid
        return {'success': True}
    else:
        flash('Login after registration failed.')
        return {'success': False}, 500


@auth_bp.route('/register', methods=['POST'])
def register():
    return handle_registration(request.form['username'], request.form['password'])


@auth_bp.route('/get_uuid', methods=['GET'])
def get_uuid():
    print(current_user)
    if current_user.is_authenticated:
        return {'uuid': get_current_user_uuid()}
    else:
        return {'uuid': None}, 401


@auth_bp.route('/get_name_by_uuid/<uuid>', methods=['GET'])
def get_name_by_uuid(uuid):
    user = User.query.filter_by(uuid=uuid).first()
    if user:
        return {'username': user.username}
    else:
        return {'username': None}, 404


def handle_login(username, password):
    user = User.query.filter_by(username=username).first()
    if user and check_password_hash(user.password, password):
        if login_user(user):
            flash('Login successful!')
            current_user.uuid = user.uuid
            return {'success': True}
        else:
            flash('Login failed.')
            return {'success': False}, 500
    else:
        flash('Invalid credentials.')
        return {'success': False}, 401


@auth_bp.route('/login', methods=['POST'])
def login():
    return handle_login(request.form['username'], request.form['password'])


@auth_bp.route('/logout')
def logout():
    logout_user()
    flash('Logged out successfully.')
    next_page = request.args.get("next")
    return redirect(next_page or url_for('index'))  # Redirect to index or login page
