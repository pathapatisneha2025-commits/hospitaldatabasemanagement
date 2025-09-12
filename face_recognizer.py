import sys
import json
import os

# ✅ Disable GPU in TensorFlow/DeepFace
os.environ["CUDA_VISIBLE_DEVICES"] = "-1"
os.environ["TF_CPP_MIN_LOG_LEVEL"] = "3"  # Suppress TF warnings

from deepface import DeepFace

if _name_ == "_main_":
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Missing arguments"}))
        sys.exit(1)

    registered_url = sys.argv[1]
    captured_url = sys.argv[2]

    try:
        # ✅ Force CPU + lightweight backend
        result = DeepFace.verify(
            registered_url,
            captured_url,
            enforce_detection=False,
            detector_backend="opencv",   # or "ssd", "mtcnn" if you want
            model_name="VGG-Face"        # lighter than Facenet512
        )
        output = {
            "match": bool(result.get("verified", False)),
            "distance": float(result.get("distance", 0.0)),
        }
        print(json.dumps(output))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)