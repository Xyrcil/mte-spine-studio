"""Decode packed Unity animation channels without resampling their polynomials."""
import math
import struct


def decode_packed_animation(data):
    muscle = data.get("m_MuscleClip", {})
    packed = muscle.get("m_Clip", {}).get("data")
    if not packed:
        return None
    start, stop = muscle["m_StartTime"], muscle["m_StopTime"]
    if not all(math.isfinite(value) for value in (start, stop)) or stop < start:
        raise ValueError("Invalid packed animation interval")
    bindings = data.get("m_ClipBindingConstant", {}).get("genericBindings", [])
    channels = []
    for binding in bindings:
        if binding.get("isPPtrCurve"):
            raise ValueError("Packed object-reference animation is not supported")
        width = {1: 3, 2: 4, 3: 3, 4: 3}.get(binding["attribute"], 1) if binding["typeID"] == 4 else 1
        for component in range(width):
            channels.append({"binding": binding, "component": component})
    streamed = packed["m_StreamedClip"]
    count = streamed["curveCount"]
    dense = packed["m_DenseClip"]
    dense_count = dense["m_CurveCount"]
    constants = packed.get("m_ConstantClip", {}).get("data", [])
    if count < 0 or dense_count < 0 or len(channels) != count + dense_count + len(constants):
        raise ValueError("Packed animation bindings do not match channel counts")
    words = streamed["data"]
    buffer = struct.pack("<" + "I" * len(words), *words)
    offset, previous = 0, -math.inf
    for channel in channels[:count]:
        channel.update(kind="polynomial", keys=[])
    while offset < len(buffer):
        if offset + 8 > len(buffer):
            raise ValueError("Truncated streamed animation frame")
        time, size = struct.unpack_from("<fi", buffer, offset)
        offset += 8
        if math.isnan(time) or time < previous or size < 0 or size > count or offset + size * 20 > len(buffer):
            raise ValueError("Invalid streamed animation frame")
        previous, seen = time, set()
        for _ in range(size):
            index, *coeff = struct.unpack_from("<i4f", buffer, offset)
            offset += 20
            if index < 0 or index >= count or index in seen or not all(math.isfinite(value) for value in coeff):
                raise ValueError("Invalid streamed animation channel")
            seen.add(index)
            if time == -math.inf:
                channels[index]["initial"] = coeff[3]
            elif math.isfinite(time) and time <= stop:
                channels[index]["keys"].append({"time": time, "coeff": coeff})
    for channel in channels[:count]:
        if not channel["keys"] and "initial" not in channel:
            raise ValueError("Streamed animation channel has no values")
    frames, rate, begin = dense["m_FrameCount"], dense["m_SampleRate"], dense["m_BeginTime"]
    values = dense["m_SampleArray"]
    if frames < 0 or len(values) != frames * dense_count or not all(math.isfinite(value) for value in values + constants):
        raise ValueError("Invalid dense or constant animation data")
    if dense_count and (frames < 1 or not math.isfinite(rate) or rate <= 0 or not math.isfinite(begin)):
        raise ValueError("Invalid dense animation timing")
    for index in range(dense_count):
        channels[count + index].update(kind="dense", begin=begin, rate=rate, values=values[index::dense_count])
    for index, value in enumerate(constants):
        channels[count + dense_count + index].update(kind="constant", value=value)
    return {"schema": 1, "start": start, "stop": stop, "loop": bool(muscle.get("m_LoopTime")), "channels": channels}


def sample_packed_channel(channel, time):
    if not math.isfinite(time):
        raise ValueError("Invalid animation sample time")
    if channel["kind"] == "constant":
        return channel["value"]
    if channel["kind"] == "dense":
        values = channel["values"]
        position = max(0, min(len(values) - 1, (time - channel["begin"]) * channel["rate"]))
        index = int(position)
        return values[index] + (values[min(index + 1, len(values) - 1)] - values[index]) * (position - index)
    key = next((key for key in reversed(channel["keys"]) if key["time"] <= time), None)
    if key is None:
        return channel["initial"] if "initial" in channel else channel["keys"][0]["coeff"][3]
    a, b, c, d = key["coeff"]
    delta = time - key["time"]
    return ((a * delta + b) * delta + c) * delta + d
