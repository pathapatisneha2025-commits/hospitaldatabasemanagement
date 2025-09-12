from flask import Flask, request, jsonify
from deepface import DeepFace

app = Flask(__name__)

@app.route("/verify", methods=["POST"])
def verify():
    data = request.json
    registered_url = data.get("registered_url")
    captured_url = data.get("captured_url")

    try:
        result = DeepFace.verify(registered_url, captured_url)
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=10000)
