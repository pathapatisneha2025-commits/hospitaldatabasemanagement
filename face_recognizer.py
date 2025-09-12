from flask import Flask, request, jsonify
from deepface import DeepFace

app = Flask(_name_)

@app.route("/verify-face", methods=["POST"])
def verify_face():
    try:
        data = request.get_json()
        registered = data.get("registered_url")
        captured = data.get("captured_url")
        
        if not registered or not captured:
            return jsonify({"error": "Missing URLs"}), 400

        # Debug logs (will show up in Render logs)
        print(f"Received registered_url: {registered}")
        print(f"Received captured_url: {captured}")

        # Verify faces (disable enforce_detection to avoid crashes if face not found)
        result = DeepFace.verify(
            img1_path=registered,
            img2_path=captured,
            enforce_detection=False
        )
        
        return jsonify({
            "verified": result.get("verified"),
            "distance": result.get("distance")
        })

    except Exception as e:
        print("Error in verify_face:", str(e))
        return jsonify({"error": str(e)}), 500

if _name_ == "_main_":
    app.run(host="0.0.0.0", port=10000)