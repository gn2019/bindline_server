from enum import Enum

from flask_login import UserMixin
from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()


class User(db.Model, UserMixin):
    id = db.Column(db.Integer, primary_key=True)
    uuid = db.Column(db.String(36), unique=True, nullable=False)
    username = db.Column(db.String(150), unique=True, nullable=False)
    password = db.Column(db.String(256), nullable=False)


class FileType(Enum):
    FASTA = 1
    SCORE = 2


class File(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    uuid = db.Column(db.String(36), unique=True, nullable=False)
    filename = db.Column(db.String(255), nullable=False)
    file_type = db.Column(db.Enum(FileType), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    is_public = db.Column(db.Boolean, default=False)
    dataset = db.Column(db.String(50), nullable=False)
    publication = db.Column(db.String(50), nullable=False)
    species = db.Column(db.String(50), nullable=False)
    notes = db.Column(db.String(255), nullable=False)

    user = db.relationship('User', backref=db.backref('files', lazy=True))

    def to_public_json(self):
        return {
            'id': self.id,
            'filename': self.filename,
            'file_type': self.file_type.name,
            'dataset': self.dataset,
            'publication': self.publication,
            'species': self.species,
            'notes': self.notes
        }


def init_db(app):
    app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///database.db'
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
    db.init_app(app)
    with app.app_context():
        db.create_all()