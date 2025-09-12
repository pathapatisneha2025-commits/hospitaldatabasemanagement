from flask import Flask, request, jsonify
from deepface import DeepFace

app = Flask(__name__)

@app.route("/verify-face", methods=["POST"])
def verify_face():
    data = request.json
    registered = data.get("registered_url")
    captured = data.get("captured_url")
    
    if not registered or not captured:
        return jsonify({"error": "Missing URLs"}), 400
    
    result = DeepFace.verify(registered, captured)
    return jsonify(result)

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=10000)  # Render will bind to this port
