from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
import librosa
import os

app = Flask(__name__, static_folder=".", template_folder=".")
CORS(app)

UPLOAD_FOLDER = "temp_uploads"
os.makedirs(UPLOAD_FOLDER, exist_ok=True)


@app.route("/")
def serve_index():
  return send_from_directory(".", "index.html")


@app.route("/<path:path>")
def serve_static(path):
  return send_from_directory(".", path)

@app.route("/detect-bpm", methods=["POST"])
def detect_bpm():
  print("-> May pumasok na request para sa BPM detection!")

  if "audio" not in request.files:
    return jsonify({"error": "Walang audio file na naipadala"}), 400

  file = request.files["audio"]
  if file.filename == "":
    return jsonify({"error": "Walang napiling file"}), 400

  file_path = os.path.join(UPLOAD_FOLDER, file.filename)
  file.save(file_path)

  try:
    # Pansamantalang magbalik muna ng stable na default BPM para hindi mag-500 error
    # habang tina-troubleshoot natin ang librosa package sa Python 3.14
    detected_bpm = 120.0
    print(f"-> Mock BPM na ibinalik: {detected_bpm}")

    if os.path.exists(file_path):
      os.remove(file_path)

    return jsonify({"bpm": detected_bpm})

  except Exception as e:
    print(f"-> ERROR: {str(e)}")
    if os.path.exists(file_path):
      os.remove(file_path)
    return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
  print("Starting Python BPM Server on http://127.0.0.1:5000")
  app.run(port=5000, debug=True)
