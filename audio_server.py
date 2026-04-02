#!/usr/bin/env python3
"""
Simple Flask server for audio analysis using openSMILE and trained model.
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import os
import tempfile
import numpy as np
import pandas as pd
import opensmile
import joblib
from werkzeug.utils import secure_filename

app = Flask(__name__)
CORS(app)  # Enable CORS for frontend requests

# Configuration
UPLOAD_FOLDER = tempfile.gettempdir()
ALLOWED_EXTENSIONS = {'wav', 'mp3', 'ogg', 'm4a'}

# Feature columns matching test.ipynb
FEATURE_COLUMNS = [
    # Pitch variability
    "F0semitoneFrom27.5Hz_sma3nz_amean",
    "F0semitoneFrom27.5Hz_sma3nz_stddevNorm",
    
    # Loudness dynamics
    "loudness_sma3_amean",
    "loudness_sma3_stddevNorm",
    
    # Voice stability
    "HNRdBACF_sma3nz_amean",
    
    # Pause / rhythm structure
    "VoicedSegmentsPerSec",
    "MeanUnvoicedSegmentLength",
    
    # Spectral envelope
    "mfcc1_sma3_amean",
    "mfcc2_sma3_amean",
]

DEMENTIA_BANK_FEATURE_COLUMNS = [

     "F0semitoneFrom27.5Hz_sma3nz_amean",
    "F0semitoneFrom27.5Hz_sma3nz_stddevNorm",
    "loudness_sma3_amean",
    "loudness_sma3_stddevNorm",
    "HNRdBACF_sma3nz_amean",
    "mfcc1_sma3_amean",
    "mfcc2_sma3_amean",
]

# Initialize openSMILE
smile = opensmile.Smile(
    feature_set=opensmile.FeatureSet.eGeMAPSv02,
    feature_level=opensmile.FeatureLevel.Functionals,
)

# Global variables for model and scaler (loaded on startup)
model = None
scaler = None


def load_model_and_scaler(model_path="model.joblib", scaler_path="scaler.joblib"):
    """Load the trained model and scaler."""
    global model, scaler
    
    if not os.path.exists(model_path):
        print(f"Warning: Model file not found at {model_path}")
        return False
    
    if not os.path.exists(scaler_path):
        print(f"Warning: Scaler file not found at {scaler_path}")
        return False
    
    try:
        scaler = joblib.load(scaler_path)
        model = joblib.load(model_path)
        print(f"✅ Loaded model from {model_path}")
        print(f"✅ Loaded scaler from {scaler_path}")
        return True
    except Exception as e:
        print(f"Error loading model/scaler: {e}")
        return False


def allowed_file(filename):
    """Check if file extension is allowed."""
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def extract_features_from_wav(wav_path: str) -> pd.DataFrame:
    """Extract eGeMAPS features from audio file."""
    try:
        feats = smile.process_file(wav_path).reset_index(drop=True)
        
        # Check for missing columns
        missing = [c for c in DEMENTIA_BANK_FEATURE_COLUMNS if c not in feats.columns]
        if missing:
            raise ValueError(f"Missing columns in openSMILE output: {missing}")
        
        return feats[DEMENTIA_BANK_FEATURE_COLUMNS].copy()
    except Exception as e:
        raise ValueError(f"Error extracting features: {str(e)}")


@app.route('/analyze', methods=['POST'])
def analyze_audio():
    """Endpoint to receive audio file and return prediction."""
    if 'audio' not in request.files:
        return jsonify({'error': 'No audio file provided'}), 400
    
    file = request.files['audio']
    
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400
    
    if not allowed_file(file.filename):
        return jsonify({'error': 'Invalid file type'}), 400
    
    if model is None or scaler is None:
        return jsonify({
            'error': 'Model or scaler not loaded',
            'prediction': 'Model not available',
            'probabilities': None
        }), 503
    
    # Save uploaded file temporarily
    temp_path = None
    try:
        # Create temporary file
        with tempfile.NamedTemporaryFile(delete=False, suffix='.wav') as tmp_file:
            temp_path = tmp_file.name
            file.save(temp_path)
        
        # Extract features
        X = extract_features_from_wav(temp_path)
        
        # Scale features
        X_scaled = scaler.transform(X)
        
        # Predict
        prediction = model.predict(X_scaled)[0]
        
        # Get probabilities if available
        probabilities = None
        if hasattr(model, 'predict_proba'):
            proba = model.predict_proba(X_scaled)[0]
            # Get class names if available
            if hasattr(model, 'classes_'):
                class_names = model.classes_
                probabilities = {str(name): float(prob) for name, prob in zip(class_names, proba)}
            else:
                # Use indices if no class names
                probabilities = {f'Class_{i}': float(prob) for i, prob in enumerate(proba)}
        
        return jsonify({
            'prediction': str(prediction),
            'probabilities': probabilities,
            'features_extracted': len(FEATURE_COLUMNS),
            'status': 'success'
        })
    
    except Exception as e:
        return jsonify({
            'error': str(e),
            'prediction': 'Error',
            'probabilities': None
        }), 500
    
    finally:
        # Clean up temporary file
        if temp_path and os.path.exists(temp_path):
            try:
                os.unlink(temp_path)
            except:
                pass


@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint."""
    return jsonify({
        'status': 'ok',
        'model_loaded': model is not None,
        'scaler_loaded': scaler is not None
    })


if __name__ == '__main__':
    # Try to load model and scaler
    model_path = os.getenv('MODEL_PATH', 'dementiabank_model.joblib')
    scaler_path = os.getenv('SCALER_PATH', 'dementiabank_scaler.joblib')
    load_model_and_scaler(model_path, scaler_path)
    
    if model is None or scaler is None:
        print("⚠️  Warning: Running without model/scaler. Predictions will not work.")
        print("   Place model.joblib and scaler.joblib in the current directory,")
        print("   or set MODEL_PATH and SCALER_PATH environment variables.")
    
    # Run server
    port = int(os.getenv('PORT', 5001))
    print(f"\n🚀 Starting audio analysis server on http://localhost:{port}")
    print(f"📡 Endpoint: POST http://localhost:{port}/analyze")
    print(f"❤️  Health check: GET http://localhost:{port}/health\n")
    
    app.run(host='0.0.0.0', port=port, debug=True)
