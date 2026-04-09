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

function RouteComponent() {
  const imageRef = useRef<HTMLImageElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const referenceInputRef = useRef<HTMLInputElement>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [faceMatcher, setFaceMatcher] = useState<faceapi.FaceMatcher | null>(null)
  const [referenceImages, setReferenceImages] = useState<ReferenceImage[]>([])
  const [hasProcessed, setHasProcessed] = useState(false)
  const [pendingReference, setPendingReference] = useState<{ url: string; descriptor: Float32Array } | null>(null)
  const [pendingLabel, setPendingLabel] = useState('')

  const MAX_REFERENCES = 3

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

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const url = URL.createObjectURL(file)
    setImageUrl(url)
    setError(null)
    setHasProcessed(false)
    
    // Clear previous canvas
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d')
      if (ctx) {
        ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height)
      }
    }
  }

  const handleProcessImage = async () => {
    if (!imageRef.current || !canvasRef.current || isLoading || !faceMatcher) return

    setIsProcessing(true)
    setError(null)
    try {
      console.log('Detecting faces in image...')
      
      // Detect faces with descriptors
      const detections = await faceapi
        .detectAllFaces(imageRef.current, new faceapi.TinyFaceDetectorOptions())
        .withFaceLandmarks()
        .withFaceExpressions()
        .withFaceDescriptors()

      console.log('Detections found:', detections.length)

      // Set canvas dimensions to match image
      const displaySize = {
        width: imageRef.current.width,
        height: imageRef.current.height,
      }
      
      faceapi.matchDimensions(canvasRef.current, displaySize)
      const resizedDetections = faceapi.resizeResults(detections, displaySize)

      // Clear canvas and draw detections
      const ctx = canvasRef.current.getContext('2d')
      if (ctx) {
        ctx.clearRect(0, 0, displaySize.width, displaySize.height)
      }
      
      faceapi.draw.drawDetections(canvasRef.current, resizedDetections)
      faceapi.draw.drawFaceLandmarks(canvasRef.current, resizedDetections)
      faceapi.draw.drawFaceExpressions(canvasRef.current, resizedDetections)

      // Add face recognition labels
      resizedDetections.forEach((detection) => {
        const bestMatch = faceMatcher.findBestMatch(detection.descriptor)
        const label = bestMatch.toString()
        
        // Draw label above the face box
        const { x, y } = detection.detection.box
        if (ctx) {
          ctx.fillStyle = 'red'
          ctx.font = '16px Arial'
          ctx.fillText(label, x, y - 10)
        }
      })

      setHasProcessed(true)
      setIsProcessing(false)
    } catch (err) {
      console.error('Error detecting faces:', err)
      setError(err instanceof Error ? err.message : 'Failed to detect faces')
      setIsProcessing(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-900">
        <div className="p-4 text-white">Loading models...</div>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 p-8">
      <h1 className="text-3xl font-bold text-white mb-8">Face Recognition</h1>
      
      {error && (
        <div className="mb-4 p-4 bg-red-600 text-white rounded-lg max-w-2xl">
          Error: {error}
        </div>
      )}

      <div className="mb-6 w-full max-w-2xl">
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

        {/* Step 2: Upload Analysis Image */}
        <div className="mb-6 p-4 bg-gray-800 rounded-lg">
          <h2 className="text-xl font-semibold text-white mb-4">Step 2: Upload Analysis Image</h2>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleImageUpload}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isProcessing}
            className="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white font-semibold rounded-lg transition-colors"
          >
            Upload Analysis Image
          </button>
        </div>

        {/* Step 3: Process Image */}
        <div className="mb-6 p-4 bg-gray-800 rounded-lg">
          <h2 className="text-xl font-semibold text-white mb-4">Step 3: Process Image</h2>
          <button
            onClick={handleProcessImage}
            disabled={!imageUrl || isProcessing || hasProcessed}
            className="px-6 py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 text-white font-semibold rounded-lg transition-colors"
          >
            {isProcessing ? 'Processing...' : hasProcessed ? 'Processed' : 'Process Image'}
          </button>
        </div>
      </div>

      {imageUrl && (
        <div className="relative">
          <img
            ref={imageRef}
            src={imageUrl}
            alt="Analysis"
            className="rounded-lg border-2 border-gray-700 max-w-full max-h-[600px]"
            crossOrigin="anonymous"
          />
          <canvas
            ref={canvasRef}
            className="absolute top-0 left-0 rounded-lg"
          />
        </div>
      )}
    </div>
  )
}
