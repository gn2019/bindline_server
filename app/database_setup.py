from enum import Enum

from flask_login import UserMixin
from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()


class User(db.Model, UserMixin):
    id = db.Column(db.Integer, primary_key=True)
    uuid = db.Column(db.String(36), unique=True, nullable=False)
    username = db.Column(db.String(150), unique=True, nullable=False)
    password = db.Column(db.String(256), nullable=False)


file2pfam = db.Table(
    "file2pfam",
    db.Column("file_id", db.Integer, db.ForeignKey("file.id"), primary_key=True),
    db.Column("pfam_id", db.Integer, db.ForeignKey("pfam.id"), primary_key=True),
)


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

    pfams = db.relationship(
        "Pfam",
        secondary=file2pfam,
        back_populates="files",
    )

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


class Pfam(db.Model):
    id = db.Column(db.Integer, primary_key=True, unique=True, nullable=False)
    name = db.Column(db.String(50), unique=True, nullable=False)

    files = db.relationship(
        "File",
        secondary=file2pfam,
        back_populates="pfams",
    )


def init_db(app):
    app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///database.db'
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
    db.init_app(app)
    with app.app_context():
        db.create_all()