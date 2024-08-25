import os
from google.cloud import vision

# Get the absolute path to the root directory
root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Set the path to your JSON key file
os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = os.path.join(root_dir, "hookify_gcvapi.json")

# Detects unsafe features in the file.
def detect_safe_search(image_content):
    """ Detects unsafe features in the file."""
    client = vision.ImageAnnotatorClient()
    image = vision.Image(content=image_content)

    response = client.safe_search_detection(image=image) # type: ignore
    safe = response.safe_search_annotation

    likelihood_name = (
        "UNKNOWN",
        "VERY_UNLIKELY",
        "UNLIKELY",
        "POSSIBLE",
        "LIKELY",
        "VERY_LIKELY",
    )

    results = {
        "adult": likelihood_name[safe.adult],
        "medical": likelihood_name[safe.medical],
        "spoofed": likelihood_name[safe.spoof],
        "violence": likelihood_name[safe.violence],
        "racy": likelihood_name[safe.racy]
    }

    if response.error.message:
        raise Exception(
            "{}\nFor more info on error messages, check: "
            "https://cloud.google.com/apis/design/errors".format(response.error.message)
        )
    
    return results