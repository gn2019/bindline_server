from flask import Blueprint, render_template, request, redirect, url_for, flash, session
from flask_login import login_user, UserMixin, logout_user
from werkzeug.security import generate_password_hash, check_password_hash
from database_setup import db, User  # Import database and User model

auth_bp = Blueprint('auth', __name__)

@auth_bp.route('/register', methods=['GET', 'POST'])
def register():
    if request.method == 'POST':
        username = request.form['username']
        # username must be alphanumeric and between 3 and 20 characters
        if not username.isalnum() or not 3 <= len(username) <= 20:
            flash('Invalid username.')
            return {'success': False}

        password = request.form['password']

        existing_user = User.query.filter_by(username=username).first()
        if existing_user:
            flash('Username already exists.')
            return {'success': False}

        hashed_password = generate_password_hash(password)
        new_user = User(username=username, password=hashed_password)
        db.session.add(new_user)
        db.session.commit()

        flash('Registration successful!')
        login_user(new_user)
        return {'success': True}


@auth_bp.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        username = request.form['username']
        password = request.form['password']

        user = User.query.filter_by(username=username).first()
        if user and check_password_hash(user.password, password):
            login_user(user)
            flash('Login successful!')
            return {'success': True}
        else:
            flash('Invalid credentials.')
            return {'success': False}


@auth_bp.route('/logout')
def logout():
    logout_user()
    flash('Logged out successfully.')
    next_page = request.args.get("next")
    return redirect(next_page or url_for('index.html'))  # Redirect to index or login page
