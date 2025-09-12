import sys
import json
from deepface import DeepFace

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Missing arguments"}))
        sys.exit(1)

    registered_url = sys.argv[1]
    captured_url = sys.argv[2]

    try:
        result = DeepFace.verify(registered_url, captured_url)
        output = {
            "match": result["verified"],
            "distance": float(result["distance"]),
        }
        print(json.dumps(output))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
