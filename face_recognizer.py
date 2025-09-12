from flask import Flask, request, jsonify
from deepface import DeepFace
from PIL import Image
import requests
from io import BytesIO
import os

# Force CPU & suppress TF warnings
os.environ["CUDA_VISIBLE_DEVICES"] = "-1"
os.environ["TF_CPP_MIN_LOG_LEVEL"] = "2"

app = Flask(__name__)

# ✅ Preload a lighter model once
model = DeepFace.build_model("OpenFace")  # lighter than Facenet

def resize_image(url, size=(160, 160)):
    """Download and resize image to reduce memory usage."""
    response = requests.get(url)
    img = Image.open(BytesIO(response.content)).convert("RGB")
    img = img.resize(size)
    temp_path = "/tmp/resized.jpg"
    img.save(temp_path)
    return temp_path

@app.route("/verify", methods=["POST"])
def verify_face():
    data = request.json
    registered_url = data.get("registeredUrl")
    captured_url = data.get("capturedUrl")

    if not registered_url or not captured_url:
        return jsonify({"error": "Missing URLs"}), 400

    try:
        # ✅ Resize images to reduce memory footprint
        reg_path = resize_image(registered_url)
        cap_path = resize_image(captured_url)

        # ✅ Use lighter model & opencv backend
        result = DeepFace.verify(
            reg_path,
            cap_path,
            model=model,
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
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
