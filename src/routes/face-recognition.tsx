import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import * as faceapi from 'face-api.js'

export const Route = createFileRoute('/face-recognition')({
  component: RouteComponent,
})

interface ReferenceImage {
  url: string
  label: string
  descriptor: Float32Array
}

interface AnalysisResult {
  timestamp: Date
  imageUrl: string
  detectionCount: number
}

function RouteComponent() {
  // Video refs
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  
  // Analysis refs
  const analysisImageRef = useRef<HTMLImageElement>(null)
  const analysisCanvasRef = useRef<HTMLCanvasElement>(null)
  
  // Reference image refs
  const referenceInputRef = useRef<HTMLInputElement>(null)
  
  // State
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isStreaming, setIsStreaming] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [faceMatcher, setFaceMatcher] = useState<faceapi.FaceMatcher | null>(null)
  const [referenceImages, setReferenceImages] = useState<ReferenceImage[]>([])
  const [pendingReference, setPendingReference] = useState<{ url: string; descriptor: Float32Array } | null>(null)
  const [pendingLabel, setPendingLabel] = useState('')
  const [latestAnalysis, setLatestAnalysis] = useState<AnalysisResult | null>(null)
  const [captureInterval, setCaptureInterval] = useState(5) // seconds
  const [nextCaptureIn, setNextCaptureIn] = useState<number>(0)

  const MAX_REFERENCES = 6

  // Load models on mount
  useEffect(() => {
    const loadModels = async () => {
      try {
        console.log('Loading models...')
        const MODEL_URL = '/models'
        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
          faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
          faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
          faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL),
        ])
        console.log('Models loaded successfully')

        // Initialize with empty matcher
        setFaceMatcher(new faceapi.FaceMatcher([], 0.6))

        setIsLoading(false)
      } catch (err) {
        console.error('Error loading models:', err)
        setError(err instanceof Error ? err.message : 'Failed to load models')
        setIsLoading(false)
      }
    }

    loadModels()
  }, [])

  // Start camera stream
  const startCamera = async () => {
    try {
      setError(null)
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720 },
        audio: false,
      })
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        streamRef.current = stream
        setIsStreaming(true)
      }
    } catch (err) {
      console.error('Error accessing camera:', err)
      setError(err instanceof Error ? err.message : 'Failed to access camera')
    }
  }

  // Stop camera stream
  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop())
      streamRef.current = null
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
    setIsStreaming(false)
    setNextCaptureIn(0)
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopCamera()
    }
  }, [])

  // Periodic capture and analysis
  useEffect(() => {
    if (!isStreaming || !faceMatcher) {
      console.log('Skipping capture setup:', { isStreaming, hasFaceMatcher: !!faceMatcher })
      return
    }

    console.log('Setting up periodic capture with interval:', captureInterval)

    let intervalId: NodeJS.Timeout
    let countdownId: NodeJS.Timeout
    let timeRemaining = captureInterval

    // Countdown timer
    const updateCountdown = () => {
      setNextCaptureIn(timeRemaining)
      timeRemaining -= 1
      if (timeRemaining < 0) {
        timeRemaining = captureInterval
      }
    }

    // Initial countdown
    updateCountdown()
    countdownId = setInterval(updateCountdown, 1000)

    // Capture and analyze
    const captureAndAnalyze = async () => {
      console.log('captureAndAnalyze called')
      
      if (!videoRef.current) {
        console.error('videoRef.current is null')
        return
      }

      // Check if video is ready
      if (videoRef.current.readyState !== videoRef.current.HAVE_ENOUGH_DATA) {
        console.log('Video not ready yet, readyState:', videoRef.current.readyState)
        return
      }

      try {
        setIsProcessing(true)
        console.log('Starting capture...')
        
        // Capture frame from video
        const canvas = document.createElement('canvas')
        canvas.width = videoRef.current.videoWidth
        canvas.height = videoRef.current.videoHeight
        
        console.log('Canvas dimensions:', canvas.width, 'x', canvas.height)
        
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          console.error('Failed to get canvas context')
          return
        }
        
        ctx.drawImage(videoRef.current, 0, 0)
        const imageUrl = canvas.toDataURL('image/jpeg')
        
        console.log('Image captured, data URL length:', imageUrl.length)

        // Update latest analysis first to show the image
        setLatestAnalysis({
          timestamp: new Date(),
          imageUrl,
          detectionCount: 0,
        })

        // Wait a bit for the image to render
        await new Promise(resolve => setTimeout(resolve, 100))

        if (!analysisImageRef.current) {
          console.error('analysisImageRef.current is null')
          setIsProcessing(false)
          return
        }

        // Run face detection and recognition
        console.log('Running face detection...')
        const detections = await faceapi
          .detectAllFaces(analysisImageRef.current, new faceapi.TinyFaceDetectorOptions())
          .withFaceLandmarks()
          .withFaceExpressions()
          .withFaceDescriptors()

        console.log('Detections found:', detections.length)

        if (!analysisCanvasRef.current) {
          console.error('analysisCanvasRef.current is null')
          setIsProcessing(false)
          return
        }

        // Set canvas dimensions to match image
        const displaySize = {
          width: analysisImageRef.current.naturalWidth,
          height: analysisImageRef.current.naturalHeight,
        }
        
        console.log('Display size:', displaySize)
        
        faceapi.matchDimensions(analysisCanvasRef.current, displaySize)
        const resizedDetections = faceapi.resizeResults(detections, displaySize)

        // Clear canvas and draw detections
        const analysisCtx = analysisCanvasRef.current.getContext('2d')
        if (analysisCtx) {
          analysisCtx.clearRect(0, 0, displaySize.width, displaySize.height)
        }
        
        faceapi.draw.drawDetections(analysisCanvasRef.current, resizedDetections)
        faceapi.draw.drawFaceLandmarks(analysisCanvasRef.current, resizedDetections)
        faceapi.draw.drawFaceExpressions(analysisCanvasRef.current, resizedDetections)

        // Add face recognition labels
        resizedDetections.forEach((detection) => {
          const bestMatch = faceMatcher.findBestMatch(detection.descriptor)
          const label = bestMatch.toString()
          
          console.log('Recognition result:', label)
          
          // Draw label above the face box
          const { x, y } = detection.detection.box
          if (analysisCtx) {
            analysisCtx.fillStyle = 'red'
            analysisCtx.font = '16px Arial'
            analysisCtx.fillText(label, x, y - 10)
          }
        })

        // Update latest analysis with detection count
        setLatestAnalysis({
          timestamp: new Date(),
          imageUrl,
          detectionCount: detections.length,
        })

        setIsProcessing(false)
        console.log('Analysis complete')
        
        // Reset countdown
        timeRemaining = captureInterval
      } catch (err) {
        console.error('Error analyzing frame:', err)
        setError(err instanceof Error ? err.message : 'Failed to analyze frame')
        setIsProcessing(false)
      }
    }

    // Wait for video to be ready before first capture
    const checkVideoReady = () => {
      if (videoRef.current && videoRef.current.readyState === videoRef.current.HAVE_ENOUGH_DATA) {
        console.log('Video ready, starting initial capture')
        captureAndAnalyze()
      } else {
        console.log('Waiting for video to be ready...')
        setTimeout(checkVideoReady, 500)
      }
    }

    checkVideoReady()

    // Set up interval for periodic capture
    intervalId = setInterval(captureAndAnalyze, captureInterval * 1000)

    return () => {
      console.log('Cleaning up capture intervals')
      clearInterval(intervalId)
      clearInterval(countdownId)
    }
  }, [isStreaming, faceMatcher, captureInterval])

  // Reference image handling
  const handleReferenceUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    if (referenceImages.length >= MAX_REFERENCES) {
      setError(`Maximum ${MAX_REFERENCES} reference images allowed`)
      return
    }

    setIsProcessing(true)
    setError(null)
    try {
      const url = URL.createObjectURL(file)
      
      // Verify face detection
      const img = await faceapi.fetchImage(url)
      const detection = await faceapi
        .detectSingleFace(img, new faceapi.TinyFaceDetectorOptions())
        .withFaceLandmarks()
        .withFaceDescriptor()

      if (detection) {
        // Face detected, set as pending for labeling
        setPendingReference({ url, descriptor: detection.descriptor })
        console.log('Face detected in reference image')
      } else {
        // No face detected, discard
        URL.revokeObjectURL(url)
        setError('No face detected in the uploaded image. Please upload a different image.')
      }
    } catch (err) {
      console.error('Error processing reference image:', err)
      setError(err instanceof Error ? err.message : 'Failed to process reference image')
    }
    setIsProcessing(false)
    
    // Reset file input
    event.target.value = ''
  }

  const handleSaveReference = () => {
    if (!pendingReference || !pendingLabel.trim()) {
      setError('Please enter a label for this person')
      return
    }

    const newReference: ReferenceImage = {
      url: pendingReference.url,
      label: pendingLabel.trim(),
      descriptor: pendingReference.descriptor
    }

    setReferenceImages(prev => [...prev, newReference])

    // Update face matcher
    const labeledDescriptors = [...referenceImages, newReference].reduce((acc, ref) => {
      const existing = acc.find(ld => ld.label === ref.label)
      if (existing) {
        existing.descriptors.push(ref.descriptor)
      } else {
        acc.push(new faceapi.LabeledFaceDescriptors(ref.label, [ref.descriptor]))
      }
      return acc
    }, [] as faceapi.LabeledFaceDescriptors[])

    setFaceMatcher(new faceapi.FaceMatcher(labeledDescriptors, 0.6))

    // Clear pending
    setPendingReference(null)
    setPendingLabel('')
    console.log(`Added reference image for ${newReference.label}`)
  }

  const handleDiscardReference = () => {
    if (pendingReference) {
      URL.revokeObjectURL(pendingReference.url)
      setPendingReference(null)
      setPendingLabel('')
    }
  }

  const handleRemoveReference = (index: number) => {
    const removed = referenceImages[index]
    URL.revokeObjectURL(removed.url)
    
    const newReferences = referenceImages.filter((_, i) => i !== index)
    setReferenceImages(newReferences)

    // Update face matcher
    const labeledDescriptors = newReferences.reduce((acc, ref) => {
      const existing = acc.find(ld => ld.label === ref.label)
      if (existing) {
        existing.descriptors.push(ref.descriptor)
      } else {
        acc.push(new faceapi.LabeledFaceDescriptors(ref.label, [ref.descriptor]))
      }
      return acc
    }, [] as faceapi.LabeledFaceDescriptors[])

    setFaceMatcher(new faceapi.FaceMatcher(labeledDescriptors, 0.6))
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-900">
        <div className="p-4 text-white">Loading models...</div>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center min-h-screen bg-gray-900 p-8">
      <h1 className="text-3xl font-bold text-white mb-8">Live Face Recognition</h1>
      
      {error && (
        <div className="mb-4 p-4 bg-red-600 text-white rounded-lg max-w-6xl w-full">
          Error: {error}
        </div>
      )}

      <div className="w-full max-w-6xl">
        {/* Step 1: Upload Reference Images */}
        <div className="mb-6 p-4 bg-gray-800 rounded-lg">
          <h2 className="text-xl font-semibold text-white mb-4">Step 1: Upload Reference Images ({referenceImages.length}/{MAX_REFERENCES})</h2>
          
          <input
            ref={referenceInputRef}
            type="file"
            accept="image/*"
            onChange={handleReferenceUpload}
            className="hidden"
          />
          <button
            onClick={() => referenceInputRef.current?.click()}
            disabled={isProcessing || referenceImages.length >= MAX_REFERENCES || pendingReference !== null}
            className="px-6 py-3 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 text-white font-semibold rounded-lg transition-colors mb-4"
          >
            Upload Reference Image
          </button>

          {/* Pending Reference for Verification */}
          {pendingReference && (
            <div className="mb-4 p-4 bg-gray-700 rounded-lg">
              <h3 className="text-white font-semibold mb-2">Verify & Label Reference Image</h3>
              <img src={pendingReference.url} alt="Pending reference" className="max-h-40 rounded mb-2" />
              <p className="text-green-400 mb-2">✓ Face detected!</p>
              <input
                type="text"
                value={pendingLabel}
                onChange={(e) => setPendingLabel(e.target.value)}
                placeholder="Enter person's name (e.g., Alice)"
                className="w-full px-3 py-2 bg-gray-600 text-white rounded mb-2"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleSaveReference}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded"
                >
                  Save
                </button>
                <button
                  onClick={handleDiscardReference}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded"
                >
                  Discard
                </button>
              </div>
            </div>
          )}

          {/* Saved References */}
          {referenceImages.length > 0 && (
            <div className="grid grid-cols-3 gap-4">
              {referenceImages.map((ref, index) => (
                <div key={index} className="relative">
                  <img src={ref.url} alt={ref.label} className="w-full h-32 object-cover rounded" />
                  <div className="absolute bottom-0 left-0 right-0 bg-black bg-opacity-75 text-white text-sm p-1 text-center">
                    {ref.label}
                  </div>
                  <button
                    onClick={() => handleRemoveReference(index)}
                    className="absolute top-1 right-1 bg-red-600 text-white rounded-full w-6 h-6 flex items-center justify-center"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Step 2: Camera Controls */}
        <div className="mb-6 p-4 bg-gray-800 rounded-lg">
          <h2 className="text-xl font-semibold text-white mb-4">Step 2: Camera Controls</h2>
          <div className="flex gap-4 items-center mb-4">
            <button
              onClick={startCamera}
              disabled={isStreaming}
              className="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white font-semibold rounded-lg transition-colors"
            >
              Start Camera
            </button>
            <button
              onClick={stopCamera}
              disabled={!isStreaming}
              className="px-6 py-3 bg-red-600 hover:bg-red-700 disabled:bg-gray-600 text-white font-semibold rounded-lg transition-colors"
            >
              Stop Camera
            </button>
            <div className="flex items-center gap-2">
              <label className="text-white">Capture Interval:</label>
              <input
                type="number"
                min="1"
                max="60"
                value={captureInterval}
                onChange={(e) => setCaptureInterval(Number(e.target.value))}
                disabled={isStreaming}
                className="px-3 py-2 bg-gray-700 text-white rounded w-20"
              />
              <span className="text-white">seconds</span>
            </div>
          </div>
          {isStreaming && (
            <div className="text-white">
              Next capture in: <span className="font-bold text-green-400">{nextCaptureIn}s</span>
              {isProcessing && <span className="ml-4 text-yellow-400">Processing...</span>}
            </div>
          )}
        </div>

        {/* Video and Analysis Display */}
        <div className="grid grid-cols-2 gap-6">
          {/* Live Video Feed */}
          <div className="bg-gray-800 rounded-lg p-4">
            <h3 className="text-xl font-semibold text-white mb-4">Live Camera Feed</h3>
            <div className="relative bg-black rounded-lg overflow-hidden" style={{ aspectRatio: '16/9' }}>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-contain"
              />
              {!isStreaming && (
                <div className="absolute inset-0 flex items-center justify-center text-gray-400">
                  Camera not started
                </div>
              )}
            </div>
          </div>

          {/* Analysis Results */}
          <div className="bg-gray-800 rounded-lg p-4">
            <h3 className="text-xl font-semibold text-white mb-4">
              Analysis Results
              {latestAnalysis && (
                <span className="text-sm font-normal text-gray-400 ml-2">
                  ({latestAnalysis.timestamp.toLocaleTimeString()})
                </span>
              )}
            </h3>
            <div className="relative bg-black rounded-lg overflow-hidden">
              {latestAnalysis ? (
                <div className="relative inline-block w-full">
                  <img
                    ref={analysisImageRef}
                    src={latestAnalysis.imageUrl}
                    alt="Analysis"
                    className="w-full h-auto"
                    crossOrigin="anonymous"
                  />
                  <canvas
                    ref={analysisCanvasRef}
                    className="absolute top-0 left-0"
                    style={{ width: '100%', height: '100%' }}
                  />
                  <div className="absolute bottom-2 left-2 bg-black bg-opacity-75 text-white px-3 py-1 rounded">
                    Faces detected: {latestAnalysis.detectionCount}
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center text-gray-400 h-64">
                  No analysis yet
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
