require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'CaptureNative'
  s.version        = package['version']
  s.summary        = 'FuelGuard self-built document scanner (iOS Vision/VisionKit).'
  s.description    = 'Custom Expo module over VNDocumentCameraViewController + VNRecognizeText. On-device.'
  s.license        = 'MIT'
  s.author         = 'FuelGuard'
  s.homepage       = 'https://fuelguard.app'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.{h,m,swift}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
