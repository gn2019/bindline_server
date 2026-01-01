import functools
import uuid

from flask import flash, Blueprint, request
from flask_login import login_required, current_user

from .database_setup import db, File, FileType, Pfam

# create blueprint for file operations
files_bp = Blueprint('files', __name__)


@files_bp.route('/upload', methods=['POST'])
def upload_metadata_route():
    print(request.form)
    filename = request.form.get('filename')
    file_type = FileType[request.form.get('file_type')]
    is_public = request.form.get('is_public', 'false').lower() == 'true'
    success, new_file = upload_metadata(filename, file_type, is_public)
    if success:
        return {'success': True, 'file_uuid': new_file.uuid}
    else:
        return {'success': False}, 500


@files_bp.route('/delete', methods=['POST'])
def delete_file_route():
    filename = request.form.get('filename')
    file_type = FileType[request.form.get('file_type')]
    file = get_file_by_name(filename, file_type)
    if not file:
        return {'success': False, 'error': 'File not found'}, 404
    if file.is_public:
        return {'success': False, 'error': 'Cannot delete public file'}, 403
    return delete_file(file.uuid)


@files_bp.route('/get_name_by_uuid/<uuid>', methods=['GET'])
def get_name_by_uuid(uuid):
    file = File.query.filter_by(uuid=uuid).first()
    if file and (file.is_public or (current_user.is_authenticated and file.user_id == current_user.id)):
        return {'filename': file.filename}
    else:
        return {'filename': None}, 404


@files_bp.route('/get_file', methods=['POST'])
def get_file_by_name_route():
    filename = request.form.get('filename')
    file_type = FileType[request.form.get('file_type')]
    file = get_file_by_name(filename, file_type)
    if file:
        return {
            'uuid': file.uuid,
            'filename': file.filename,
            'file_type': file.file_type.name,
            'user_id': file.user_id,
            'is_public': file.is_public
        }
    else:
        return {'error': 'File not found'}, 404


def upload_metadata(filename, file_type, is_public):
    if not current_user.is_authenticated and not is_public:
        flash('Authentication required for private file upload.')
        return None

    # if filename in the db, return existing entry
    existing_file = get_file_by_name(filename, file_type, is_public)
    if existing_file:
        flash('File metadata already exists!')
        return existing_file

    # add file metadata to database
    new_file = File(
        uuid=str(uuid.uuid4()),
        filename=filename,
        file_type=file_type,
        user_id=0 if is_public else current_user.id,
        is_public=is_public
    )
    db.session.add(new_file)
    db.session.commit()

    flash('File metadata uploaded successfully!')
    return new_file


def get_file_by_id(file_id):
    file = File.query.filter_by(id=file_id).first()
    if file and (file.is_public or (current_user.is_authenticated and file.user_id == current_user.id)):
        return file


def get_file_by_name(filename, file_type, is_public=None):
    file = None
    if current_user.is_authenticated and is_public is not True:
        file = File.query.filter_by(filename=filename, file_type=file_type, user_id=current_user.id).first()
    if not file and is_public is not False:
        # print(filename, file_type)
        file = File.query.filter_by(filename=filename, file_type=file_type, is_public=True).first()
    return file


@login_required
def get_user_files():
    # retrieve file metadata from database
    return File.query.filter_by(user_id=current_user.id).all()


def list_user_score_files():
    return File.query.filter_by(user_id=current_user.id, file_type=FileType.SCORE).order_by(File.filename).all()


def list_user_fasta_files():
    # return sorted by filename
    return File.query.filter_by(user_id=current_user.id, file_type=FileType.FASTA).order_by(File.filename).all()


def list_public_score_files():
    return File.query.filter_by(is_public=True, file_type=FileType.SCORE).order_by(File.filename).all()


def list_public_fasta_files():
    return File.query.filter_by(is_public=True, file_type=FileType.FASTA).order_by(File.dataset, File.filename).all()


def list_user_public_score_files():
    user_files = list_user_score_files() if current_user.is_authenticated else []
    public_files = list_public_score_files()
    return user_files, public_files


def list_user_public_fasta_files():
    user_files = list_user_fasta_files() if current_user.is_authenticated else []
    public_files = list_public_fasta_files()
    return user_files, public_files


@login_required
def delete_file(file_uuid):
    # delete file metadata from database
    file = File.query.filter_by(uuid=file_uuid, user_id=current_user.id).first()
    if file:
        db.session.delete(file)
        db.session.commit()
        flash('File metadata deleted successfully!')
        return {'success': True}
    else:
        flash('File not found or unauthorized.')
        return {'success': False}, 404


def get_pfam_ids(file_id):
    file = get_file_by_id(file_id)
    if not file:
        return []
    return [pfam.id for pfam in file.pfams]


@functools.lru_cache(maxsize=128)
def get_pfam_name(pfam_id):
    pfam = Pfam.query.filter_by(id=pfam_id).first()
    return pfam.name if pfam else None


def list_pfams():
    return Pfam.query.order_by(Pfam.name).all()


def update_file_pfams(file, pfam_ids):
    pfams = Pfam.query.filter(Pfam.id.in_(pfam_ids)).all()
    file.pfams = pfams
    db.session.commit()
