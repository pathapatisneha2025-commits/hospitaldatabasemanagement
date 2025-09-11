import sys
import face_recognition
import requests
import numpy as np
import json
import tempfile
import os

def download_image(url):
    response = requests.get(url)
    response.raise_for_status()
    tmp_file = tempfile.NamedTemporaryFile(delete=False, suffix=".jpg")
    tmp_file.write(response.content)
    tmp_file.close()
    return tmp_file.name

def get_descriptor(image_path):
    img = face_recognition.load_image_file(image_path)
    encodings = face_recognition.face_encodings(img)
    return encodings[0] if encodings else None

def main():
    if len(sys.argv) != 3:
        print(json.dumps({"error": "Usage: face_recognizer.py <registered_url> <captured_url>"}))
        sys.exit(1)

    registered_url, captured_url = sys.argv[1], sys.argv[2]

    # Download both images
    reg_path = download_image(registered_url)
    cap_path = download_image(captured_url)

    try:
        reg_desc = get_descriptor(reg_path)
        cap_desc = get_descriptor(cap_path)

        if reg_desc is None or cap_desc is None:
            print(json.dumps({"match": False, "distance": None, "error": "Face not detected"}))
        else:
            distance = np.linalg.norm(reg_desc - cap_desc)
            is_match = distance < 0.6
            print(json.dumps({"match": is_match, "distance": float(distance)}))
    finally:
        os.remove(reg_path)
        os.remove(cap_path)

if __name__ == "__main__":
    main()
