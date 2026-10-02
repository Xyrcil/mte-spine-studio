import copy
import math
import struct
import unittest
from tools.unity_animation import decode_packed_animation, sample_packed_channel


def frame(time, rows):
    raw = struct.pack("<fi", time, len(rows))
    for index, coeff in rows:
        raw += struct.pack("<i4f", index, *coeff)
    return list(struct.unpack("<" + "I" * (len(raw) // 4), raw))


def clip():
    words = frame(-math.inf, [(0, [0, 0, 0, 2])]) + frame(0, [(0, [1, 2, 3, 4])]) + frame(1, [(0, [0, 0, 0, 10])]) + frame(math.inf, [])
    return {"m_MuscleClip": {"m_StartTime": 0, "m_StopTime": 2, "m_LoopTime": False, "m_Clip": {"data": {"m_StreamedClip": {"curveCount": 1, "data": words}, "m_DenseClip": {"m_CurveCount": 1, "m_FrameCount": 3, "m_SampleRate": 1, "m_BeginTime": 0, "m_SampleArray": [0, 2, 4]}, "m_ConstantClip": {"data": [7]}}}}, "m_ClipBindingConstant": {"genericBindings": [{"path": 0, "typeID": 4, "attribute": 3}]}}


class PackedAnimationTests(unittest.TestCase):
    def test_streamed_polynomials_dense_samples_and_constants_keep_binding_order(self):
        decoded = decode_packed_animation(clip())
        self.assertEqual([row["component"] for row in decoded["channels"]], [0, 1, 2])
        a, b, c = decoded["channels"]
        self.assertEqual(sample_packed_channel(a, -.1), 2)
        self.assertEqual(sample_packed_channel(a, .5), 6.125)
        self.assertEqual(sample_packed_channel(a, 1), 10)
        self.assertEqual(sample_packed_channel(a, 1.5), 10)
        self.assertEqual(sample_packed_channel(b, .5), 1)
        self.assertEqual(sample_packed_channel(b, 9), 4)
        self.assertEqual(sample_packed_channel(c, 9), 7)

    def test_initial_only_stream_and_nonzero_clip_start_are_preserved(self):
        data = clip()
        packed = data["m_MuscleClip"]["m_Clip"]["data"]
        packed["m_StreamedClip"]["data"] = frame(-math.inf, [(0, [0, 0, 0, 3])])
        self.assertEqual(sample_packed_channel(decode_packed_animation(data)["channels"][0], 1), 3)
        data = clip()
        data["m_MuscleClip"]["m_StartTime"] = .5
        self.assertEqual(sample_packed_channel(decode_packed_animation(data)["channels"][0], .5), 6.125)

    def test_malformed_frames_and_binding_counts_fail_explicitly(self):
        changes = [lambda p: p["m_StreamedClip"]["data"].pop(), lambda p: p["m_StreamedClip"].update(data=frame(0, [(4, [0, 0, 0, 1])])), lambda p: p["m_StreamedClip"].update(data=frame(0, [(0, [0, 0, 0, 1]), (0, [0, 0, 0, 2])])), lambda p: p["m_StreamedClip"].update(data=frame(1, []) + frame(0, [])), lambda p: p["m_StreamedClip"].update(data=frame(0, [(0, [math.nan, 0, 0, 1])])), lambda p: p["m_DenseClip"].update(m_SampleArray=[]), lambda p: p["m_DenseClip"].update(m_SampleRate=0), lambda p: p["m_ConstantClip"].update(data=[])]
        for change in changes:
            data = copy.deepcopy(clip())
            change(data["m_MuscleClip"]["m_Clip"]["data"])
            with self.assertRaises(ValueError):
                decode_packed_animation(data)

    def test_object_reference_channels_and_invalid_intervals_are_not_guessed(self):
        data = clip()
        data["m_ClipBindingConstant"]["genericBindings"][0]["isPPtrCurve"] = 1
        with self.assertRaises(ValueError):
            decode_packed_animation(data)
        data = clip()
        data["m_MuscleClip"]["m_StopTime"] = -1
        with self.assertRaises(ValueError):
            decode_packed_animation(data)
        self.assertIsNone(decode_packed_animation({}))

    def test_zero_length_controller_poses_are_valid_source_data(self):
        data = clip()
        data["m_MuscleClip"]["m_StopTime"] = 0
        decoded = decode_packed_animation(data)
        self.assertEqual(decoded["start"], decoded["stop"])
        self.assertEqual(sample_packed_channel(decoded["channels"][0], 0), 4)
