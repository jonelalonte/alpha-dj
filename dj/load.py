from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
import librosa
import os

# Siguraduhing tama ang pag-point ng static at template folders sa kasalukuyang directory
BASE_DIR = os.path.abspath(os.path.dirname(__file__))

app = Flask(__name__, static_folder=BASE_DIR, template_folder=BASE_DIR)
CORS(app)

UPLOAD_FOLDER = os.path.join(BASE_DIR, "temp_uploads")
os.makedirs(UPLOAD_FOLDER, exist_ok=True)


@app.route("/")
def serve_index():
  return send_from_directory(BASE_DIR, "index.html")


# ILAGAY ANG MGA SPECIFIC ROUTES DITO SA TAAS (Bago ang catch-all path)
@app.route("/detect-bpm", methods=["POST"])
def detect_bpm():
  print("-> May pumasok na request para sa BPM detection!")

  if "audio" not in request.files:
    print("-> Error: Walang audio file sa request.")
    return jsonify({"error": "Walang audio file na naipadala"}), 400

  file = request.files["audio"]
  if file.filename == "":
    print("-> Error: Walang filename.")
    return jsonify({"error": "Walang napiling file"}), 400

  file_path = os.path.join(UPLOAD_FOLDER, file.filename)
  file.save(file_path)
  print(f"-> Na-save ang pansamantalang file sa: {file_path}")

  try:
    print(
        "-> Sinisimulan nang basahin ng Librosa ang audio (memory-optimized)..."
    )
    y, sr = librosa.load(file_path, sr=22050, duration=30.0)
    print(f"-> Tapos nang basahin. Sample rate: {sr}, haba (y): {len(y)}")

    print("-> Sinasukat ang beat/tempo...")
    tempo, _ = librosa.beat.beat_track(y=y, sr=sr)

    if hasattr(tempo, "__len__"):
      detected_bpm = float(tempo[0])
    else:
      detected_bpm = float(tempo)

    print(f"-> Nahanap na BPM: {detected_bpm}")

    if os.path.exists(file_path):
      os.remove(file_path)

    return jsonify({"bpm": round(detected_bpm, 1)})

  except Exception as e:
    print(f"-> ERROR sa pag-process ng Librosa: {str(e)}")
    if os.path.exists(file_path):
      os.remove(file_path)
    return jsonify({"error": str(e)}), 500


# ANG CATCH-ALL ROUTE AY DAPAT LAGING NASA PINAKA-BABA
@app.route("/<path:path>")
def serve_static(path):
  return send_from_directory(BASE_DIR, path)


if __name__ == "__main__":
  print("Starting Python BPM Server on http://127.0.0.1:5000")
  app.run(port=5000, debug=True)
