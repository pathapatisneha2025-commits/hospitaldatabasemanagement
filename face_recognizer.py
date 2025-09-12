from flask import Flask, request, jsonify
from deepface import DeepFace
import os

# Force CPU (avoid GPU issues)
os.environ["CUDA_VISIBLE_DEVICES"] = "-1"
os.environ["TF_CPP_MIN_LOG_LEVEL"] = "2"

app = Flask(__name__)

@app.route("/verify", methods=["POST"])
def verify_face():
    data = request.json
    registered_url = data.get("registeredUrl")
    captured_url = data.get("capturedUrl")

    if not registered_url or not captured_url:
        return jsonify({"error": "Missing URLs"}), 400

    try:
        result = DeepFace.verify(
            registered_url,
            captured_url,
            enforce_detection=False,
            detector_backend="opencv"
        )
        return jsonify({
            "match": result["verified"],
            "distance": float(result["distance"])
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    # Listen on Render-assigned PORT
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
