import sys
import json
import os

# Force CPU
os.environ["CUDA_VISIBLE_DEVICES"] = "-1"

# Suppress TensorFlow info/warnings
os.environ["TF_CPP_MIN_LOG_LEVEL"] = "2"

from deepface import DeepFace


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Missing arguments"}))
        sys.exit(1)

    registered_url = sys.argv[1]
    captured_url = sys.argv[2]

    try:
        # ✅ force backend to 'opencv' (lighter, avoids heavy GPU libs)
        result = DeepFace.verify(
            registered_url,
            captured_url,
            enforce_detection=False,
            detector_backend="opencv"
        )
        output = {
            "match": result["verified"],
            "distance": float(result["distance"]),
        }
        print(json.dumps(output))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
