import sys
import json
from deepface import DeepFace

def main():
    if len(sys.argv) != 3:
        print(json.dumps({"error": "Usage: face_recognizer.py <registered_url> <captured_url>"}))
        sys.exit(1)

    registered_url, captured_url = sys.argv[1], sys.argv[2]

    try:
        # DeepFace handles downloading, detection, and embeddings internally
        result = DeepFace.verify(registered_url, captured_url, enforce_detection=True)
        print(json.dumps({
            "match": result["verified"],
            "distance": result["distance"]
        }))
    except Exception as e:
        print(json.dumps({"match": False, "distance": None, "error": str(e)}))

if __name__ == "__main__":
    main()